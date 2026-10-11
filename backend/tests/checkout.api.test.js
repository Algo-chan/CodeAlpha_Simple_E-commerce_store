/**
 * Checkout + order API tests (Phase 8).
 *
 * Exercises the full path a purchase takes — routing, Zod validation, CSRF,
 * httpOnly guest cookies, the checkout transaction, inventory deduction, the
 * ledger, payments and order history — against a real PostgreSQL engine via
 * PGlite.
 *
 * The tests care most about the guarantees the transaction exists to provide:
 *   - a successful order deducts stock, writes a ledger row, clears the cart
 *     and records a COD payment, all or nothing;
 *   - a rejected checkout leaves NO trace — no order, no stock movement, and a
 *     cart the shopper can still fix;
 *   - money is computed from the database, never the request;
 *   - one customer can never read another's order.
 *
 * Fixtures are inserted directly so stock numbers are deterministic.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';

const SESSION = 'ecom_session';
const CART = 'ecom_cart';
const ORIGIN = 'http://localhost:5173';
const FREE_THRESHOLD = 500_000;
const DEFAULT_FEE = 50_000;

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
  return `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
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
  attributes = { color: 'Black', size: '42' },
} = {}) {
  const variantId = nextId();
  const productId = nextId();
  await db.query(
    `INSERT INTO products (id, name, slug, product_type, status)
     VALUES ($1, $2, $3, 'PHYSICAL', $4)`,
    [productId, `Checkout Fixture ${seq}`, `checkout-fixture-${seq}`, productStatus]
  );
  await db.query(
    `INSERT INTO product_variants (id, product_id, sku, price, attributes, is_active)
     VALUES ($1, $2, $3, $4, $5::JSONB, $6)`,
    [variantId, productId, `SKU-CHECKOUT-${seq}`, price, JSON.stringify(attributes), variantActive]
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

async function register(email) {
  const res = await request(app).post('/api/v1/auth/register').send({
    name: 'Checkout Tester',
    email,
    phone: '0911223344',
    password: 'StrongPass1!',
    passwordConfirmation: 'StrongPass1!',
  });
  assert.equal(res.status, 201, `register should succeed (${email}): ${res.body?.error?.message}`);
  return res;
}

async function createShopper(tag = 'shopper') {
  emailSeq += 1;
  const email = `${tag}-${emailSeq}@example.com`;
  const res = await register(email);
  return { session: specificCookie(res, SESSION), email };
}

/** Adds an item as a guest and returns the cart cookie issued. */
async function guestAdd(variantId, quantity = 1) {
  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .send({ variantId, quantity });
  assert.equal(res.status, 200, `guest add failed: ${res.body?.error?.message}`);
  return specificCookie(res, CART);
}

const GUEST_CONTACT = Object.freeze({
  full_name: 'Guest Buyer',
  email: 'guest-buyer@example.com',
  phone: '0911223344',
  city: 'Addis Ababa',
  area: 'Bole',
  street: 'Bole Road 1',
});

function guestCheckout(cookie, body) {
  const req = request(app).post('/api/v1/checkout').set('Origin', ORIGIN);
  if (cookie) req.set('Cookie', cookie.raw);
  return req.send(body);
}

function authedCheckout(session, body) {
  return request(app)
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send(body);
}

async function countOrders() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM orders');
  return rows[0].n;
}

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

test('a guest can place a COD order: stock falls, cart empties, payment is PENDING', async () => {
  const { variantId } = await makeVariant({ stock: 10, price: 100000 });
  const cookie = await guestAdd(variantId, 3);

  const res = await guestCheckout(cookie, GUEST_CONTACT);

  assert.equal(res.status, 201, `checkout failed: ${res.body?.error?.message}`);
  const { order } = res.body.data;

  assert.match(order.orderNumber, /^ORD-\d{8}-\d{4}$/);
  assert.equal(order.status, 'PENDING');
  assert.equal(order.paymentStatus, 'PENDING');
  assert.equal(order.paymentMethod, 'COD');
  assert.equal(order.currency, 'ETB');

  // 3 x 100000 = 300000, under the free threshold, so the flat fee applies.
  assert.equal(order.subtotal, 300000);
  assert.equal(order.deliveryFee, DEFAULT_FEE);
  assert.equal(order.discountTotal, 0);
  assert.equal(order.total, 300000 + DEFAULT_FEE);
  assert.equal(order.itemCount, 3);

  // Line snapshots and the variant label come from the database.
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productName, `Checkout Fixture ${seq}`);
  assert.equal(order.items[0].sku, `SKU-CHECKOUT-${seq}`);
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[0].unitPrice, 100000);
  assert.equal(order.items[0].subtotal, 300000);
  // JSONB does not preserve key order, so the label's option order is not
  // contractual; the snapshot's attributes are.
  assert.deepEqual(order.items[0].variantAttributes, { color: 'Black', size: '42' });
  assert.ok(
    order.items[0].variantLabel.includes('Black') && order.items[0].variantLabel.includes('42'),
    'the variant label names the selected options'
  );

  // Contact + address snapshots.
  assert.equal(order.customer.name, 'Guest Buyer');
  assert.equal(order.customer.email, 'guest-buyer@example.com');
  assert.equal(order.shippingAddress.city, 'Addis Ababa');
  assert.equal(order.payment.provider, 'INTERNAL');
  assert.equal(order.payment.amount, 300000 + DEFAULT_FEE);

  // No internal ids leak.
  assert.equal(order.id, undefined);
  assert.equal(order.items[0].order_id, undefined);

  // Stock fell by exactly the ordered quantity.
  const { rows: stock } = await db.query(`SELECT quantity FROM inventory WHERE variant_id = $1`, [
    variantId,
  ]);
  assert.equal(stock[0].quantity, 7);

  // The ledger recorded a negative SALE tied to the order.
  const { rows: ledger } = await db.query(
    `SELECT transaction_type, quantity, reference_type FROM inventory_transactions
      WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].transaction_type, 'SALE');
  assert.equal(ledger[0].quantity, -3);
  assert.equal(ledger[0].reference_type, 'ORDER');

  // A COD payment row exists, PENDING, for the full total.
  const { rows: payments } = await db.query(
    `SELECT p.method, p.status, p.provider, p.amount
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.order_number = $1`,
    [order.orderNumber]
  );
  assert.equal(payments.length, 1);
  assert.equal(payments[0].method, 'COD');
  assert.equal(payments[0].status, 'PENDING');
  assert.equal(payments[0].provider, 'INTERNAL');
  assert.equal(Number(payments[0].amount), 300000 + DEFAULT_FEE);

  // The cart was emptied, but the guest cookie still works.
  const after = await request(app).get('/api/v1/cart').set('Cookie', cookie.raw);
  assert.equal(after.status, 200);
  assert.equal(after.body.data.cart.count, 0);
});

test('a subtotal at or above the free threshold waives the delivery fee', async () => {
  const { variantId } = await makeVariant({ stock: 5, price: 600000 });
  const cookie = await guestAdd(variantId, 1);

  const res = await guestCheckout(cookie, GUEST_CONTACT);
  assert.equal(res.status, 201);

  const { order } = res.body.data;
  assert.ok(order.subtotal >= FREE_THRESHOLD);
  assert.equal(order.deliveryFee, 0);
  assert.equal(order.total, order.subtotal);
});

test('an untracked (digital) line skips stock and the ledger entirely', async () => {
  const { variantId } = await makeVariant({ stock: null, price: 25000 });
  const cookie = await guestAdd(variantId, 4);

  const res = await guestCheckout(cookie, GUEST_CONTACT);
  assert.equal(res.status, 201);

  const { rows: inventory } = await db.query(
    `SELECT quantity FROM inventory WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(inventory.length, 0, 'no inventory row should be created');

  const { rows: ledger } = await db.query(
    `SELECT id FROM inventory_transactions WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(ledger.length, 0, 'an untracked line writes no ledger row');
});

/* -------------------------------------------------------------------------- */
/* Rejections & rollback                                                       */
/* -------------------------------------------------------------------------- */

test('an empty cart cannot be checked out', async () => {
  const res = await guestCheckout(null, GUEST_CONTACT);

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CART_EMPTY');
});

test('a guest must supply contact details', async () => {
  const { variantId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);

  const res = await guestCheckout(cookie, {
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road 1',
  });

  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('insufficient stock at checkout rolls back the whole order', async () => {
  const { variantId } = await makeVariant({ stock: 5, price: 100000 });
  const cookie = await guestAdd(variantId, 3);
  const ordersBefore = await countOrders();

  // Another sale drains the shelf after the item was added to the cart.
  await db.query(`UPDATE inventory SET quantity = 1 WHERE variant_id = $1`, [variantId]);

  const res = await guestCheckout(cookie, GUEST_CONTACT);

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');
  assert.equal(res.body.error.details.available, 1);

  // No order, no further stock movement, ledger untouched.
  assert.equal(await countOrders(), ordersBefore, 'no order should be created');
  const { rows: stock } = await db.query(`SELECT quantity FROM inventory WHERE variant_id = $1`, [
    variantId,
  ]);
  assert.equal(stock[0].quantity, 1, 'the failed checkout must not deduct stock');
  const { rows: ledger } = await db.query(
    `SELECT id FROM inventory_transactions WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(ledger.length, 0, 'the failed checkout must not write a ledger row');

  // The cart is intact so the shopper can fix the quantity. Read the stored
  // line before any GET: fetching the cart reconciles a line down to what is
  // still available, which would mask whether checkout touched it.
  const { rows: cartRows } = await db.query(
    `SELECT quantity FROM cart_items WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(cartRows[0].quantity, 3, 'the failed checkout must not touch the cart');

  const cart = await request(app).get('/api/v1/cart').set('Cookie', cookie.raw);
  assert.equal(cart.body.data.cart.items.length, 1);
});

test('an unavailable product cannot be checked out', async () => {
  const { variantId, productId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);

  await db.query(`UPDATE products SET status = 'ARCHIVED' WHERE id = $1`, [productId]);

  const res = await guestCheckout(cookie, GUEST_CONTACT);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'PRODUCT_UNAVAILABLE');
});

test('ONLINE is not an accepted payment method', async () => {
  const { variantId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);

  const res = await guestCheckout(cookie, { ...GUEST_CONTACT, payment_method: 'ONLINE' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

/* -------------------------------------------------------------------------- */
/* Authenticated checkout & order history                                      */
/* -------------------------------------------------------------------------- */

test('a signed-in customer may omit contact fields; the order links to the account', async () => {
  const { session, email } = await createShopper('buyer');
  const { variantId } = await makeVariant({ stock: 5, price: 80000 });

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ variantId, quantity: 2 });
  assert.equal(add.status, 200);

  // Only the address is supplied; name, email and phone come from the account.
  const res = await authedCheckout(session, {
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road 1',
  });

  assert.equal(res.status, 201, `checkout failed: ${res.body?.error?.message}`);
  const { order } = res.body.data;
  assert.equal(order.customer.name, 'Checkout Tester');
  assert.equal(order.customer.email, email);

  const { rows } = await db.query(`SELECT user_id FROM orders WHERE order_number = $1`, [
    order.orderNumber,
  ]);
  assert.ok(rows[0].user_id, 'an authenticated order must carry its user_id');

  // The order appears in history and resolves by number.
  const list = await request(app).get('/api/v1/orders').set('Cookie', session.raw);
  assert.equal(list.status, 200);
  assert.ok(
    list.body.data.orders.some((o) => o.orderNumber === order.orderNumber),
    'the new order must appear in history'
  );

  const detail = await request(app)
    .get(`/api/v1/orders/${order.orderNumber}`)
    .set('Cookie', session.raw);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.order.orderNumber, order.orderNumber);
  assert.equal(detail.body.data.order.items.length, 1);
});

test('order history is scoped to the signed-in customer', async () => {
  const { session: sellerSession } = await createShopper('owner');
  const { variantId } = await makeVariant({ stock: 5 });
  await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .set('Cookie', sellerSession.raw)
    .send({ variantId, quantity: 1 });
  const placed = await authedCheckout(sellerSession, {
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road 1',
  });
  assert.equal(placed.status, 201);
  const orderNumber = placed.body.data.order.orderNumber;

  const { session: strangerSession } = await createShopper('stranger');

  const list = await request(app).get('/api/v1/orders').set('Cookie', strangerSession.raw);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.orders.length, 0, 'a stranger sees no orders that are not theirs');

  const detail = await request(app)
    .get(`/api/v1/orders/${orderNumber}`)
    .set('Cookie', strangerSession.raw);
  assert.equal(detail.status, 404);
});

test('order history requires a session', async () => {
  const res = await request(app).get('/api/v1/orders');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('an order number of the wrong shape is a 422', async () => {
  const { session } = await createShopper('validator');
  const res = await request(app).get('/api/v1/orders/not-an-order').set('Cookie', session.raw);
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

/* -------------------------------------------------------------------------- */
/* Order numbering                                                             */
/* -------------------------------------------------------------------------- */

test('order numbers are unique and increase within the day', async () => {
  const first = await placeGuestOrder();
  const second = await placeGuestOrder();

  assert.notEqual(first.orderNumber, second.orderNumber);

  const suffix = (number) => Number(number.split('-').pop());
  assert.ok(
    suffix(second.orderNumber) > suffix(first.orderNumber),
    'the second order number should follow the first'
  );
  assert.match(first.orderNumber, /^ORD-\d{8}-\d{4}$/);
});

async function placeGuestOrder() {
  const { variantId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);
  const res = await guestCheckout(cookie, GUEST_CONTACT);
  assert.equal(res.status, 201, `checkout failed: ${res.body?.error?.message}`);
  return res.body.data.order;
}
