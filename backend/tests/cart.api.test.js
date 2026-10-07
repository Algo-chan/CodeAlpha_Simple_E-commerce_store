/**
 * Cart API tests (Phase 7).
 *
 * Runs the whole stack (routing, Zod validation, CSRF, httpOnly cookies, the
 * cart/inventory SQL, transactions) against a real PostgreSQL engine via
 * PGlite. Fixtures are inserted directly so stock numbers are deterministic —
 * the seeded ledger decks quantities via demo sales, which would make
 * "only 3 left" assertions brittle.
 *
 * The guest cart cookie is read off response headers exactly as a browser
 * would see it, and the tests also assert the security contract behind it:
 * the cookie is httpOnly/SameSite=Lax and the database stores only the
 * SHA-256 hash of the raw token.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'node:crypto';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';
import { hashCartToken } from '../src/repositories/cart.repository.js';

const SESSION = 'ecom_session';
const CART = 'ecom_cart';

let db;
let app;
let seq = 0;
let emailSeq = 0;

test.before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
});

test.after(async () => {
  await db?.close();
});

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                          */
/* -------------------------------------------------------------------------- */

function nextId() {
  seq += 1;
  return `20000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

/**
 * Inserts a finished product + variant (+ optional tracked inventory).
 * `stock === null` means untracked (digital). Returns the ids.
 */
async function makeVariant({
  productStatus = 'ACTIVE',
  variantActive = true,
  stock = null,
  reserved = 0,
  price = 100000,
} = {}) {
  const variantId = nextId();
  const productId = nextId();
  await db.query(
    `INSERT INTO products (id, name, slug, product_type, status)
     VALUES ($1, $2, $3, 'PHYSICAL', $4)`,
    [productId, `Cart Fixture ${seq}`, `cart-fixture-${seq}`, productStatus]
  );
  await db.query(
    `INSERT INTO product_variants (id, product_id, sku, price, attributes, is_active)
     VALUES ($1, $2, $3, $4, $5::JSONB, $6)`,
    [variantId, productId, `SKU-CART-${seq}`, price, JSON.stringify({ color: 'Black', size: '42' }), variantActive]
  );
  if (stock !== null) {
    await db.query(
      `INSERT INTO inventory (variant_id, quantity, reserved_quantity)
       VALUES ($1, $2, $3)`,
      [variantId, stock, reserved]
    );
  }
  return { variantId, productId };
}

function specificCookie(res, name) {
  const headers = res.headers['set-cookie'] ?? [];
  const list = Array.isArray(headers) ? headers : [headers];
  const entry = list.find((cookie) => cookie.startsWith(`${name}=`));
  if (!entry) return null;
  return { raw: entry, value: entry.slice(entry.indexOf('=') + 1).split(';')[0] };
}

function withCookie(res, name) {
  const cookie = specificCookie(res, name);
  return cookie ? { Cookie: cookie.raw } : {};
}

async function register(email) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: 'Cart Tester',
      email,
      phone: '0911223344',
      password: 'StrongPass1!',
      passwordConfirmation: 'StrongPass1!',
    });
  assert.equal(res.status, 201, `register should succeed (${email}): ${res.body?.error?.message}`);
  return res;
}

/** Registers a fresh shopper with a unique email. */
async function createShopper(tag = 'shopper') {
  emailSeq += 1;
  const res = await register(`${tag}-${emailSeq}@example.com`);
  return { session: specificCookie(res, SESSION) };
}

function withBoth(a, b) {
  return { Cookie: `${a.raw}; ${b.raw}` };
}

/* -------------------------------------------------------------------------- */
/* Guest cart                                                                  */
/* -------------------------------------------------------------------------- */

test('a guest gets a new cart and a secure httpOnly cookie on first read', async () => {
  const res = await request(app).get('/api/v1/cart');

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.cart.owner, 'guest');
  assert.deepEqual(res.body.data.cart.items, []);
  assert.equal(res.body.data.cart.count, 0);
  assert.equal(res.body.data.cart.subtotal, 0);

  const cookie = specificCookie(res, CART);
  assert.ok(cookie, 'guest cart cookie must be issued');
  assert.match(cookie.raw, /HttpOnly/);
  assert.match(cookie.raw, /SameSite=Lax/);
  assert.ok(cookie.value.length >= 32, 'token must be long enough to be unguessable');

  const { rows } = await db.query(
    `SELECT session_token FROM carts WHERE id = $1`,
    [res.body.data.cart.id]
  );
  assert.equal(rows[0].session_token, hashCartToken(cookie.value), 'DB stores the sha-256 hash');
  assert.match(rows[0].session_token, /^[0-9a-f]{64}$/);
  assert.notEqual(rows[0].session_token, cookie.value, 'the raw token must never be persisted');
});

test('the same guest token reads the same persistent cart', async () => {
  const { variantId } = await makeVariant({ stock: 20 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 2 });
  assert.equal(add.status, 200);

  const later = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries(withCookie(add, CART)).flat());
  assert.equal(later.status, 200);
  assert.equal(later.body.data.cart.items.length, 1);
  assert.equal(later.body.data.cart.items[0].quantity, 2);
});

test('guests without a token on a mutating route get a cart (and its cookie) back', async () => {
  const { variantId } = await makeVariant({ stock: 10 });
  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 1 });

  assert.equal(res.status, 200);
  assert.ok(specificCookie(res, CART), 'a guest add must issue the cart cookie');
});

/* -------------------------------------------------------------------------- */
/* Adding to the cart                                                          */
/* -------------------------------------------------------------------------- */

test('adding a valid variant returns server-computed price, stock and totals', async () => {
  const { variantId } = await makeVariant({ stock: 20, price: 123456 });

  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 3 });

  assert.equal(res.status, 200);
  const [line] = res.body.data.cart.items;
  assert.equal(line.variantId, variantId);
  assert.equal(line.quantity, 3);
  assert.equal(line.unitPrice, 123456, 'price comes from the database, not the client');
  assert.equal(line.lineTotal, 123456 * 3);
  assert.equal(line.maxQuantity, 20);
  assert.equal(line.unavailableReason, null);
  assert.equal(res.body.data.cart.count, 3);
  assert.equal(res.body.data.cart.subtotal, 123456 * 3);
});

test('a client-supplied price is ignored: the database price wins', async () => {
  const { variantId } = await makeVariant({ stock: 20, price: 99999 });

  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 1, price: 1, unitPrice: 1 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.cart.items[0].unitPrice, 99999);
  assert.equal(res.body.data.cart.subtotal, 99999);
});

test('adding the same variant again merges into one line by summing quantity', async () => {
  const { variantId } = await makeVariant({ stock: 20 });

  const first = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 1 });
  const second = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(withCookie(first, CART)).flat())
    .send({ variantId, quantity: 2 });

  assert.equal(second.status, 200);
  assert.equal(second.body.data.cart.items.length, 1, 'duplicates collapse to one line');
  assert.equal(second.body.data.cart.items[0].quantity, 3);
  assert.equal(second.body.data.cart.count, 3);
});

test('the digital (untracked) variant has no stock ceiling beyond the schema cap', async () => {
  const { variantId } = await makeVariant({ stock: null });

  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 100 });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.cart.items[0].quantity, 100);
  assert.equal(res.body.data.cart.items[0].maxQuantity, 100);
});

test('requesting more than inventory returns 409 and leaves the cart untouched', async () => {
  const { variantId } = await makeVariant({ stock: 2 });

  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 5 });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');
  assert.equal(res.body.error.details.available, 2);
});

test('adding to an existing line cannot push it past inventory', async () => {
  const { variantId } = await makeVariant({ stock: 3 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 2 });
  assert.equal(add.status, 200);

  const over = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(withCookie(add, CART)).flat())
    .send({ variantId, quantity: 2 });
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'INSUFFICIENT_STOCK');
  assert.equal(over.body.error.details.inCart, 2);
  assert.equal(over.body.error.details.available, 3);
});

test('sold-out variants and inactive/draft items are refused at add time', async () => {
  const soldOut = await makeVariant({ stock: 0 });
  const draft = await makeVariant({ productStatus: 'DRAFT', stock: 10 });
  const inactiveVariant = await makeVariant({ variantActive: false, stock: 10 });
  const unknown = '00000000-0000-4000-8000-000000000000';

  const cases = [
    { body: { variantId: soldOut.variantId, quantity: 1 }, status: 409, code: 'INSUFFICIENT_STOCK' },
    { body: { variantId: draft.variantId, quantity: 1 }, status: 409, code: 'PRODUCT_UNAVAILABLE' },
    { body: { variantId: inactiveVariant.variantId, quantity: 1 }, status: 409, code: 'PRODUCT_UNAVAILABLE' },
    { body: { variantId: unknown, quantity: 1 }, status: 404, code: 'VARIANT_NOT_FOUND' },
  ];

  for (const { body, status, code } of cases) {
    const res = await request(app)
      .post('/api/v1/cart/items')
      .set('Origin', 'http://localhost:5173')
      .send(body);
    assert.equal(res.status, status, `${body.variantId} should return ${status}`);
    assert.equal(res.body.error.code, code);
  }
});

/* -------------------------------------------------------------------------- */
/* Updating / removing / clearing                                              */
/* -------------------------------------------------------------------------- */

test('PATCH sets an exact quantity, re-validated against live inventory', async () => {
  const { variantId } = await makeVariant({ stock: 10 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 1 });
  const cartCookie = withCookie(add, CART);
  const lineId = add.body.data.cart.items[0].id;

  const ok = await request(app)
    .patch(`/api/v1/cart/items/${lineId}`)
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(cartCookie).flat())
    .send({ quantity: 4 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.cart.items[0].quantity, 4);
  assert.equal(ok.body.data.cart.subtotal, 4 * 100000);

  const over = await request(app)
    .patch(`/api/v1/cart/items/${lineId}`)
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(cartCookie).flat())
    .send({ quantity: 11 });
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'INSUFFICIENT_STOCK');
});

test('PATCH with an out-of-range quantity is a validation error', async () => {
  const { variantId } = await makeVariant({ stock: 10 });
  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 1 });
  const lineId = add.body.data.cart.items[0].id;

  for (const quantity of [0, -1, 101]) {
    const res = await request(app)
      .patch(`/api/v1/cart/items/${lineId}`)
      .set('Origin', 'http://localhost:5173')
      .set(...Object.entries(withCookie(add, CART)).flat())
      .send({ quantity });
    assert.equal(res.status, 422, `quantity ${quantity} should be rejected`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }

  const badId = await request(app)
    .patch('/api/v1/cart/items/not-a-uuid')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(withCookie(add, CART)).flat())
    .send({ quantity: 2 });
  assert.equal(badId.status, 422);
});

test('DELETE removes one line; a line from another cart is a 404', async () => {
  const { variantId: vA } = await makeVariant({ stock: 10 });
  const { variantId: vB } = await makeVariant({ stock: 10 });

  const shopper = await createShopper(`boundary`);
  const guestAdd = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: shopper.session.raw }).flat())
    .send({ variantId: vA, quantity: 1 });
  assert.equal(guestAdd.status, 200);

  const lineId = guestAdd.body.data.cart.items[0].id;

  const other = await createShopper(`boundary`);
  const foreign = await request(app)
    .delete(`/api/v1/cart/items/${lineId}`)
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: other.session.raw }).flat());
  assert.equal(foreign.status, 404, 'an item belongs to exactly one cart');
  assert.equal(foreign.body.error.code, 'CART_ITEM_NOT_FOUND');

  const own = await request(app)
    .delete(`/api/v1/cart/items/${lineId}`)
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: shopper.session.raw }).flat());
  assert.equal(own.status, 200);
  assert.equal(own.body.data.cart.items.length, 0);
});

test('DELETE /cart empties the basket but keeps the cart identity', async () => {
  const { variantId: vA } = await makeVariant({ stock: 10 });
  const { variantId: vB } = await makeVariant({ stock: 10 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId: vA, quantity: 2 });
  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(withCookie(add, CART)).flat())
    .send({ variantId: vB, quantity: 1 });

  const clear = await request(app)
    .delete('/api/v1/cart')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(withCookie(add, CART)).flat());

  assert.equal(clear.status, 200);
  assert.deepEqual(clear.body.data.cart.items, []);
  assert.equal(clear.body.data.cart.count, 0);
  assert.equal(clear.body.data.cart.subtotal, 0);
  const cookie = specificCookie(clear, CART);
  assert.equal(cookie, null, 'clearing a cart must not rotate the guest identity');
});

/* -------------------------------------------------------------------------- */
/* Authenticated cart & login merge                                           */
/* -------------------------------------------------------------------------- */

test('an authenticated shopper gets one user cart, reused across requests', async () => {
  const { variantId } = await makeVariant({ stock: 10 });
  const { session } = await createShopper(`user-cart`);

  const first = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries({ Cookie: session.raw }).flat());
  assert.equal(first.status, 200);
  assert.equal(first.body.data.cart.owner, 'user');
  const cartId = first.body.data.cart.id;

  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: session.raw }).flat())
    .send({ variantId, quantity: 1 });

  const second = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries({ Cookie: session.raw }).flat());
  assert.equal(second.body.data.cart.id, cartId, 'the user cart id is stable');
  assert.equal(second.body.data.cart.items.length, 1);
});

test('login merge sums duplicate variants (guest 2 + user 1 = 3)', async () => {
  const { variantId: vA } = await makeVariant({ stock: 10 });
  const { session } = await createShopper(`merge-sum`);

  // 1 in the user cart.
  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: session.raw }).flat())
    .send({ variantId: vA, quantity: 1 });

  // 2 in a fresh guest cart.
  const guest = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId: vA, quantity: 2 });

  // A genuine logged-in request that still carries the guest token.
  const merged = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries(withBoth(session, specificCookie(guest, CART))).flat());

  assert.equal(merged.status, 200);
  assert.equal(merged.body.data.merged, true, 'the response should declare the merge');
  const [line] = merged.body.data.cart.items;
  assert.equal(line.variantId, vA);
  assert.equal(line.quantity, 3, 'duplicate variants sum across carts');
  assert.equal(merged.body.data.cart.count, 3);

  const clear = specificCookie(merged, CART);
  assert.ok(clear, 'the spent guest cookie must be retired');
  assert.match(clear.raw, /Max-Age=0/);

  const { rows } = await db.query(
    `SELECT status, merged_into_cart_id FROM carts WHERE id = $1`,
    [guest.body.data.cart.id]
  );
  assert.equal(rows[0].status, 'CONVERTED', 'the guest cart is retired, not deleted');
  assert.equal(rows[0].merged_into_cart_id, merged.body.data.cart.id);
});

test('login merge never exceeds live inventory on the summed quantity', async () => {
  const { variantId: vA } = await makeVariant({ stock: 2 });
  const { session } = await createShopper(`merge-clamp`);

  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: session.raw }).flat())
    .send({ variantId: vA, quantity: 1 });

  const guest = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId: vA, quantity: 2 });

  const merged = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries(withBoth(session, specificCookie(guest, CART))).flat());

  assert.equal(merged.status, 200);
  assert.equal(merged.body.data.cart.items[0].quantity, 2, 'merged quantity is clamped by stock');
  assert.equal(merged.body.data.cart.items[0].maxQuantity, 2);
});

test('login merge drops items that are no longer purchasable', async () => {
  const { variantId: vA } = await makeVariant({ stock: 10, price: 5000 });
  const { variantId: vB } = await makeVariant({ stock: 0, price: 5000 });

  const { session } = await createShopper(`merge-drop`);
  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries({ Cookie: session.raw }).flat())
    .send({ variantId: vA, quantity: 1 });

  // Guest cart carries a live variant plus a now-sold-out one.
  const guest = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId: vA, quantity: 2 });
  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(withCookie(guest, CART)).flat())
    .send({ variantId: vB, quantity: 1 });

  const merged = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries(withBoth(session, specificCookie(guest, CART))).flat());

  assert.equal(merged.status, 200);
  const ids = merged.body.data.cart.items.map((line) => line.variantId);
  assert.deepEqual(ids, [vA], 'sold-out guest items do not survive the merge');
  assert.equal(merged.body.data.cart.items[0].quantity, 3);
});

test('a guest without a cart cookie who logs in simply gets their user cart', async () => {
  const { session } = await createShopper(`merge-none`);
  const merged = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries({ Cookie: session.raw }).flat());
  assert.equal(merged.status, 200);
  assert.equal(merged.body.data.merged, false);
  assert.equal(merged.body.data.cart.owner, 'user');
});

/* -------------------------------------------------------------------------- */
/* Concurrency: stock moving between display and update                        */
/* -------------------------------------------------------------------------- */

test('GET repairs a line that stock has moved under', async () => {
  const { variantId } = await makeVariant({ stock: 20 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 5 });
  assert.equal(add.status, 200);

  await db.query(`UPDATE inventory SET quantity = 2 WHERE variant_id = $1`, [variantId]);

  const read = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries(withCookie(add, CART)).flat());
  assert.equal(read.status, 200);
  assert.equal(read.body.data.cart.items[0].quantity, 2, 'display matches reality');
  assert.equal(read.body.data.cart.items[0].maxQuantity, 2);
  assert.equal(read.body.data.cart.count, 2);
  assert.equal(read.body.data.cart.subtotal, 2 * 100000);
});

test('a fully-sold-out line survives the display but is flagged, and a PATCH then fails', async () => {
  const { variantId } = await makeVariant({ stock: 5 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', 'http://localhost:5173')
    .send({ variantId, quantity: 3 });
  const cartCookie = withCookie(add, CART);
  const lineId = add.body.data.cart.items[0].id;

  await db.query(`UPDATE inventory SET quantity = 0 WHERE variant_id = $1`, [variantId]);

  const read = await request(app)
    .get('/api/v1/cart')
    .set(...Object.entries(cartCookie).flat());
  assert.equal(read.body.data.cart.items[0].unavailableReason, 'sold-out');
  assert.equal(read.body.data.cart.count, 0, 'flagged lines contribute no count/total');
  assert.equal(read.body.data.cart.subtotal, 0);

  const patch = await request(app)
    .patch(`/api/v1/cart/items/${lineId}`)
    .set('Origin', 'http://localhost:5173')
    .set(...Object.entries(cartCookie).flat())
    .send({ quantity: 1 });
  assert.equal(patch.status, 409);
  assert.equal(patch.body.error.code, 'INSUFFICIENT_STOCK');
});