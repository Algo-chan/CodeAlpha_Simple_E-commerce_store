/**
 * Coupon API tests (Phase 11).
 *
 * Two surfaces are covered here:
 *
 *   1. REDEMPTION at checkout. A coupon is optional; when supplied it must
 *      resolve, be inside its window, clear its minimum and have uses left. A
 *      valid code lowers `discountTotal` and `total`, is stamped on the order
 *      (id and code), and spends exactly one use — all inside the same
 *      transaction that creates the order. An invalid code aborts the whole
 *      checkout, leaving no order and an untouched cart.
 *
 *   2. ADMINISTRATION. An admin can create, list, fetch, update and deactivate
 *      codes; codes are normalised to upper case; duplicates are a 409 and a
 *      fixed-amount code may not declare a percentage cap. The surface is
 *      gated: a customer gets 403, a guest 401.
 *
 * The preview endpoint is checked to be read-only: it prices a code but writes
 * nothing.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';

const SESSION = 'ecom_session';
const CART = 'ecom_cart';
const ORIGIN = 'http://localhost:5173';
const DUMMY_HASH = '$2b$12$notarealhashnotarealhashnotareal';
const FREE_THRESHOLD = 500_000;
const DEFAULT_FEE = 50_000;

let db;
let app;
let seq = 0;
let emailSeq = 0;
let admin;

test.before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
  const adminUser = await createUser({ role: 'ADMIN', tag: 'admin' });
  admin = await createSession(adminUser.id);
});

test.after(async () => {
  await db?.close();
});

function nextId() {
  seq += 1;
  return `60000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

async function createUser({ role = 'CUSTOMER', tag = 'user' } = {}) {
  emailSeq += 1;
  const id = nextId();
  const email = `${tag}-${emailSeq}@example.com`;
  await db.query(
    `INSERT INTO users (id, name, email, phone, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
    [id, `Test ${tag}`, email, '0911223344', DUMMY_HASH, role]
  );
  return { id, email, name: `Test ${tag}` };
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
    [userId, hash]
  );
  return { raw: `${SESSION}=${token}` };
}

async function makeVariant({ stock = 10, price = 100000 } = {}) {
  const variantId = nextId();
  const productId = nextId();
  await db.query(
    `INSERT INTO products (id, name, slug, product_type, status)
     VALUES ($1, $2, $3, 'PHYSICAL', 'ACTIVE')`,
    [productId, `Coupon Fixture ${seq}`, `coupon-fixture-${seq}`]
  );
  await db.query(
    `INSERT INTO product_variants (id, product_id, sku, price, attributes, is_active)
     VALUES ($1, $2, $3, $4, $5::JSONB, TRUE)`,
    [variantId, productId, `SKU-COUPON-${seq}`, price, JSON.stringify({ color: 'Black' })]
  );
  if (stock !== null) {
    await db.query(`INSERT INTO inventory (variant_id, quantity, reserved_quantity) VALUES ($1, $2, 0)`, [
      variantId,
      stock,
    ]);
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

const CONTACT = Object.freeze({
  full_name: 'Guest Buyer',
  email: 'guest-buyer@example.com',
  phone: '0911223344',
  city: 'Addis Ababa',
  area: 'Bole',
  street: 'Bole Road 1',
});

async function guestAdd(variantId, quantity = 1) {
  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .send({ variantId, quantity });
  assert.equal(res.status, 200, `guest add failed: ${res.body?.error?.message}`);
  return specificCookie(res, CART);
}

async function authedAdd(session, variantId, quantity = 1) {
  const res = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ variantId, quantity });
  assert.equal(res.status, 200, `authed add failed: ${res.body?.error?.message}`);
  return res;
}

function checkout(cookie, body) {
  const req = request(app).post('/api/v1/checkout').set('Origin', ORIGIN);
  req.set('Cookie', cookie.raw);
  return req.send(body);
}

function preview(cookie, code) {
  return request(app)
    .post('/api/v1/checkout/coupon')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie.raw)
    .send({ code });
}

function adminReq(method, path, session, body) {
  const req = request(app)[method](path).set('Origin', ORIGIN).set('Cookie', session.raw);
  return body === undefined ? req : req.send(body);
}

async function countOrders() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM orders');
  return rows[0].n;
}

async function couponRow(code) {
  const { rows } = await db.query(`SELECT * FROM coupons WHERE code = $1`, [code.toUpperCase()]);
  return rows[0] ?? null;
}

/* Shared admin identity is created in the top-level before hook. */

async function createCoupon(body) {
  const res = await adminReq('post', '/api/v1/admin/coupons', admin, body);
  assert.equal(res.status, 201, `coupon create failed: ${JSON.stringify(res.body)}`);
  return res.body.data.coupon;
}

/* -------------------------------------------------------------------------- */
/* Redemption — fixed and percent                                              */
/* -------------------------------------------------------------------------- */

test('a fixed coupon discounts the order, is stamped on it, and spends one use', async () => {
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 2); // subtotal 200000
  const coupon = await createCoupon({
    code: 'save50',
    discountType: 'FIXED',
    discountValue: 50000,
  });
  assert.equal(coupon.code, 'SAVE50', 'codes are stored upper-cased');

  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'save50' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { order } = res.body.data;

  assert.equal(order.subtotal, 200000);
  assert.equal(order.discountTotal, 50000);
  assert.equal(order.total, 200000 + DEFAULT_FEE - 50000);
  assert.equal(order.couponCode, 'SAVE50');

  const row = await couponRow('SAVE50');
  assert.equal(Number(row.used_count), 1, 'one use is spent');

  const { rows } = await db.query(`SELECT coupon_id, coupon_code FROM orders WHERE order_number = $1`, [
    order.orderNumber,
  ]);
  assert.equal(rows[0].coupon_code, 'SAVE50');
  assert.equal(rows[0].coupon_id, coupon.id);
});

test('a percent coupon is capped by maxDiscount', async () => {
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 2); // subtotal 200000
  await createCoupon({
    code: 'TEN',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscount: 5000,
  });

  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'TEN' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // 10% of 200000 = 20000, capped to 5000.
  assert.equal(res.body.data.order.discountTotal, 5000);
});

test('a fixed coupon larger than the cart discounts to the delivery fee, never below', async () => {
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 1); // subtotal 100000
  await createCoupon({ code: 'HUGE', discountType: 'FIXED', discountValue: 999999 });

  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'HUGE' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.order.discountTotal, 100000, 'clamped to the subtotal');
  assert.equal(res.body.data.order.total, DEFAULT_FEE);
});

/* -------------------------------------------------------------------------- */
/* Redemption — refusals leave no trace                                        */
/* -------------------------------------------------------------------------- */

test('an unknown code aborts the checkout and creates no order', async () => {
  const { variantId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);
  const before = await countOrders();

  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'NOPE' });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'COUPON_INVALID');
  assert.equal(await countOrders(), before, 'the whole checkout rolled back');
});

test('a coupon outside its window is refused', async () => {
  const past = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await createCoupon({
    code: 'OLD',
    discountType: 'FIXED',
    discountValue: 1000,
    validFrom: past,
    validUntil: pastEnd,
  });
  const { variantId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);

  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'OLD' });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'COUPON_INVALID');
});

test('a coupon below its minimum subtotal is refused', async () => {
  await createCoupon({
    code: 'BIGSPEND',
    discountType: 'FIXED',
    discountValue: 1000,
    minSubtotal: 500000,
  });
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 1); // subtotal 100000

  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'BIGSPEND' });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'COUPON_INVALID');
});

test('a coupon whose uses are exhausted is refused', async () => {
  const coupon = await createCoupon({
    code: 'SPENT',
    discountType: 'FIXED',
    discountValue: 1000,
    maxUses: 1,
  });
  await db.query(`UPDATE coupons SET used_count = 1 WHERE id = $1`, [coupon.id]);

  const { variantId } = await makeVariant({ stock: 5 });
  const cookie = await guestAdd(variantId, 1);
  const res = await checkout(cookie, { ...CONTACT, coupon_code: 'SPENT' });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'COUPON_INVALID');
});

test('a per-user limit is enforced for a signed-in shopper', async () => {
  const shopper = await createUser({ tag: 'loyal' });
  const session = await createSession(shopper.id);
  const { variantId } = await makeVariant({ stock: 5 });
  await createCoupon({
    code: 'ONCEONLY',
    discountType: 'FIXED',
    discountValue: 1000,
    perUserLimit: 1,
  });

  await authedAdd(session, variantId, 1);
  const first = await checkout(session, { ...CONTACT, coupon_code: 'ONCEONLY' });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  await authedAdd(session, variantId, 1);
  const second = await checkout(session, { ...CONTACT, coupon_code: 'ONCEONLY' });
  assert.equal(second.status, 422, JSON.stringify(second.body));
  assert.equal(second.body.error.code, 'COUPON_INVALID');
});

/* -------------------------------------------------------------------------- */
/* Preview — prices without writing                                            */
/* -------------------------------------------------------------------------- */

test('the preview prices a code against the cart and writes nothing', async () => {
  await createCoupon({ code: 'PREVIEW', discountType: 'FIXED', discountValue: 25000 });
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 2);

  const before = await countOrders();
  const res = await preview(cookie, 'preview');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.coupon.code, 'PREVIEW');
  assert.equal(res.body.data.coupon.discount, 25000);

  assert.equal(await countOrders(), before, 'preview never creates an order');
  assert.equal(Number((await couponRow('PREVIEW')).used_count), 0, 'preview never spends a use');
});

test('the preview refuses a code the cart cannot use', async () => {
  await createCoupon({
    code: 'PREVIEWBIG',
    discountType: 'FIXED',
    discountValue: 1000,
    minSubtotal: 500000,
  });
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 1);

  const res = await preview(cookie, 'PREVIEWBIG');
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'COUPON_INVALID');
});

/* -------------------------------------------------------------------------- */
/* Administration                                                              */
/* -------------------------------------------------------------------------- */

test('an admin can create, list, fetch, update and deactivate a coupon', async () => {
  const created = await createCoupon({
    code: 'ADMINRUN',
    description: 'Launch week',
    discountType: 'PERCENT',
    discountValue: 15,
    minSubtotal: 0,
    maxUses: 100,
  });
  assert.equal(created.code, 'ADMINRUN');
  assert.equal(created.isActive, true);
  assert.equal(created.usedCount, 0);
  assert.equal(created.remainingUses, 100);

  const list = await adminReq('get', '/api/v1/admin/coupons?search=ADMINRUN', admin);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.coupons.length, 1);
  assert.equal(list.body.meta.pagination.total, 1);

  const fetched = await adminReq('get', `/api/v1/admin/coupons/${created.id}`, admin);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.coupon.code, 'ADMINRUN');

  const updated = await adminReq('patch', `/api/v1/admin/coupons/${created.id}`, admin, {
    description: 'Extended',
    maxUses: 200,
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.coupon.description, 'Extended');
  assert.equal(updated.body.data.coupon.maxUses, 200);

  const off = await adminReq('post', `/api/v1/admin/coupons/${created.id}/deactivate`, admin);
  assert.equal(off.status, 200);
  assert.equal(off.body.data.coupon.isActive, false);

  const on = await adminReq('post', `/api/v1/admin/coupons/${created.id}/activate`, admin);
  assert.equal(on.status, 200);
  assert.equal(on.body.data.coupon.isActive, true);

  const logs = await adminReq('get', '/api/v1/admin/audit-logs?entityType=COUPON', admin);
  const actions = logs.body.data.logs.map((log) => log.action);
  assert.ok(actions.includes('COUPON_CREATED'), 'creation is audited');
  assert.ok(actions.includes('COUPON_DEACTIVATED'), 'deactivation is audited');
  assert.ok(actions.includes('COUPON_ACTIVATED'), 'activation is audited');
});

test('an admin cannot create two coupons with the same code', async () => {
  await createCoupon({ code: 'DUPE', discountType: 'FIXED', discountValue: 1000 });
  const again = await adminReq('post', '/api/v1/admin/coupons', admin, {
    code: 'dupe',
    discountType: 'FIXED',
    discountValue: 2000,
  });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.error.code, 'CONFLICT');
});

test('a fixed-amount coupon cannot declare a maximum discount', async () => {
  const res = await adminReq('post', '/api/v1/admin/coupons', admin, {
    code: 'BADS',
    discountType: 'FIXED',
    discountValue: 1000,
    maxDiscount: 500,
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
});

test('the coupon admin surface is gated', async () => {
  const shopper = await createUser({ tag: 'shopper' });
  const session = await createSession(shopper.id);

  const forbidden = await adminReq('get', '/api/v1/admin/coupons', session);
  assert.equal(forbidden.status, 403);

  const anonymous = await request(app).get('/api/v1/admin/coupons').set('Origin', ORIGIN);
  assert.equal(anonymous.status, 401);
});

/* -------------------------------------------------------------------------- */
/* Regression — a coupon-less order is unchanged                               */
/* -------------------------------------------------------------------------- */

test('an order without a coupon keeps a zero discount and a null code', async () => {
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  const cookie = await guestAdd(variantId, 1);

  const res = await checkout(cookie, { ...CONTACT });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.order.discountTotal, 0);
  assert.equal(res.body.data.order.couponCode, null);
  assert.equal(res.body.data.order.total, 100000 + DEFAULT_FEE);
});

// Keep the free-threshold constant meaningful even though the fixtures above all
// sit below it; a change to the delivery rule should surface here first.
test('the delivery rule the coupon tests rely on still holds', async () => {
  const { variantId } = await makeVariant({ price: FREE_THRESHOLD, stock: 5 });
  const cookie = await guestAdd(variantId, 1);
  const res = await checkout(cookie, { ...CONTACT });
  assert.equal(res.body.data.order.deliveryFee, 0);
});
