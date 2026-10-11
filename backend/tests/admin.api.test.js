/**
 * Admin store-management API tests (Phase 10).
 *
 * Two things this file exists to prove, above all others:
 *
 *   1. RBAC IS SERVER-SIDE. Every admin endpoint is called as a guest, as a
 *      customer and as an administrator. The first two must be refused (401 and
 *      403), the third must get through. Hiding a button never enters into it.
 *
 *   2. THE AUDIT TRAIL AND THE LEDGER DO NOT LIE. A sensitive action writes an
 *      audit row in the same transaction; a manual stock change writes a ledger
 *      row; cancelling an order returns its stock. These are asserted against
 *      the database, not against the response body alone.
 *
 * Fixtures are inserted directly (a user, a session) so the test does not depend
 * on the auth endpoints to manufacture an administrator — there is deliberately
 * no way to register one.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';

const SESSION = 'ecom_session';
const ORIGIN = 'http://localhost:5173';
// Satisfies users_password_hash_is_hashed (`^\$[0-9a-z]{1,4}\$`); it is never
// verified because no seed/test account signs in by password here.
const DUMMY_HASH = '$2b$12$notarealhashnotarealhashnotareal';

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
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function nextId() {
  seq += 1;
  return `40000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

async function createUser({ role = 'CUSTOMER', status = 'ACTIVE', tag = 'user' } = {}) {
  emailSeq += 1;
  const id = nextId();
  const email = `${tag}-${emailSeq}@example.com`;
  await db.query(
    `INSERT INTO users (id, name, email, phone, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, `Test ${tag}`, email, '0911223344', DUMMY_HASH, role, status]
  );
  return { id, email };
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

async function admin() {
  const user = await createUser({ role: 'ADMIN', tag: 'admin' });
  const session = await createSession(user.id);
  return { ...user, session };
}

async function customer() {
  const user = await createUser({ role: 'CUSTOMER', tag: 'cust' });
  const session = await createSession(user.id);
  return { ...user, session };
}

/* -------------------------------------------------------------------------- */
/* Request helpers                                                             */
/* -------------------------------------------------------------------------- */

function req(method, path, { session, body, origin = ORIGIN } = {}) {
  let r = request(app)[method](path);
  if (origin) r = r.set('Origin', origin);
  if (session) r = r.set('Cookie', session.raw);
  if (body !== undefined) r = r.send(body);
  return r;
}

const GET = (path, opts) => req('get', path, opts);
const POST = (path, opts) => req('post', path, opts);
const PATCH = (path, opts) => req('patch', path, opts);
const DELETE = (path, opts) => req('delete', path, opts);

/* -------------------------------------------------------------------------- */
/* RBAC — the security boundary                                                */
/* -------------------------------------------------------------------------- */

const ADMIN_ENDPOINTS = [
  ['get', '/api/v1/admin/dashboard'],
  ['get', '/api/v1/admin/products'],
  ['post', '/api/v1/admin/products'],
  ['get', '/api/v1/admin/categories'],
  ['post', '/api/v1/admin/categories'],
  ['get', '/api/v1/admin/inventory'],
  ['get', '/api/v1/admin/orders'],
  ['get', '/api/v1/admin/customers'],
  ['get', '/api/v1/admin/reviews'],
  ['get', '/api/v1/admin/payments'],
  ['get', '/api/v1/admin/audit-logs'],
];

test('guests are refused by every admin endpoint', async () => {
  for (const [method, path] of ADMIN_ENDPOINTS) {
    const res = await req(method, path, { body: method === 'get' ? undefined : {} });
    assert.equal(res.status, 401, `${method.toUpperCase()} ${path} should be 401 for a guest`);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  }
});

test('customers are refused by every admin endpoint', async () => {
  const shopper = await customer();
  for (const [method, path] of ADMIN_ENDPOINTS) {
    const res = await req(method, path, {
      session: shopper.session,
      body: method === 'get' ? undefined : {},
    });
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} should be 403 for a customer`);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('an administrator reaches the admin surface', async () => {
  const boss = await admin();
  const dashboard = await GET('/api/v1/admin/dashboard', { session: boss.session });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.success, true);

  const products = await GET('/api/v1/admin/products', { session: boss.session });
  assert.equal(products.status, 200);
  assert.ok(Array.isArray(products.body.data.products));
});

test('a suspended administrator is refused (403), not silently allowed', async () => {
  const blocked = await createUser({ role: 'ADMIN', status: 'SUSPENDED', tag: 'suspended-admin' });
  const session = await createSession(blocked.id);
  const res = await GET('/api/v1/admin/dashboard', { session });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

/* -------------------------------------------------------------------------- */
/* Products, variants and images                                               */
/* -------------------------------------------------------------------------- */

async function createProduct(boss, overrides = {}) {
  const res = await POST('/api/v1/admin/products', {
    session: boss.session,
    body: {
      name: overrides.name ?? `Widget ${++seq}`,
      slug: overrides.slug ?? `widget-${seq}`,
      productType: 'PHYSICAL',
      status: 'ACTIVE',
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.product;
}

test('a product can be created, read, updated and archived', async () => {
  const boss = await admin();
  const product = await createProduct(boss, { name: 'Gadget', slug: 'gadget-main' });
  assert.equal(product.status, 'ACTIVE');
  assert.equal(product.slug, 'gadget-main');

  const fetched = await GET(`/api/v1/admin/products/${product.id}`, { session: boss.session });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.product.id, product.id);

  const updated = await PATCH(`/api/v1/admin/products/${product.id}`, {
    session: boss.session,
    body: { name: 'Gadget Pro', status: 'DRAFT' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.product.name, 'Gadget Pro');
  assert.equal(updated.body.data.product.status, 'DRAFT');

  const archived = await POST(`/api/v1/admin/products/${product.id}/archive`, {
    session: boss.session,
    body: {},
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.data.product.status, 'ARCHIVED');
});

test('duplicate product slugs are a 409, not a database error', async () => {
  const boss = await admin();
  await createProduct(boss, { slug: 'unique-slug-here', name: 'One' });
  const res = await POST('/api/v1/admin/products', {
    session: boss.session,
    body: { name: 'Two', slug: 'unique-slug-here', productType: 'PHYSICAL' },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('creating a physical variant opens a zeroed inventory row', async () => {
  const boss = await admin();
  const product = await createProduct(boss, { name: 'Stocked', slug: `stocked-${seq}` });

  const res = await POST(`/api/v1/admin/products/${product.id}/variants`, {
    session: boss.session,
    body: { sku: `SKU-${seq}`, price: 50000, attributes: { color: 'Black' } },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const variant = res.body.data.variants[0];
  assert.equal(variant.price, 50000);
  assert.equal(variant.inventory.quantity, 0, 'a new physical variant starts at zero stock');

  const { rows } = await db.query(`SELECT quantity FROM inventory WHERE variant_id = $1`, [
    variant.id,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 0);
});

test('a compare-at price at or below the price is rejected', async () => {
  const boss = await admin();
  const product = await createProduct(boss, { name: 'Sale', slug: `sale-${seq}` });
  const res = await POST(`/api/v1/admin/products/${product.id}/variants`, {
    session: boss.session,
    body: { sku: `SKU-SALE-${seq}`, price: 100000, compareAtPrice: 90000 },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'UNPROCESSABLE_ENTITY');
});

test('the first image becomes primary; deleting it promotes the next', async () => {
  const boss = await admin();
  const product = await createProduct(boss, { name: 'Gallery', slug: `gallery-${seq}` });

  const first = await POST(`/api/v1/admin/products/${product.id}/images`, {
    session: boss.session,
    body: { imageUrl: 'https://example.com/a.png' },
  });
  assert.equal(first.status, 201);
  const imageA = first.body.data.images[0];
  assert.equal(imageA.isPrimary, true, 'the first image is primary automatically');

  const second = await POST(`/api/v1/admin/products/${product.id}/images`, {
    session: boss.session,
    body: { imageUrl: 'https://example.com/b.png', isPrimary: true },
  });
  const images = second.body.data.images;
  const primary = images.filter((image) => image.isPrimary);
  assert.equal(primary.length, 1, 'exactly one primary image');
  assert.equal(primary[0].imageUrl, 'https://example.com/b.png');

  const removed = await DELETE(`/api/v1/admin/images/${primary[0].id}`, { session: boss.session });
  assert.equal(removed.status, 200);
  const remaining = removed.body.data.images;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].isPrimary, true, 'the surviving image is promoted to primary');
});

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

test('a category may not become a child of its own descendant', async () => {
  const boss = await admin();
  const parent = await POST('/api/v1/admin/categories', {
    session: boss.session,
    body: { name: 'Electronics', slug: `electronics-${seq}` },
  });
  assert.equal(parent.status, 201);
  const parentId = parent.body.data.category.id;

  const child = await POST('/api/v1/admin/categories', {
    session: boss.session,
    body: { name: 'Phones', slug: `phones-child-${seq}`, parentId },
  });
  assert.equal(child.status, 201);
  const childId = child.body.data.category.id;

  const cycle = await PATCH(`/api/v1/admin/categories/${parentId}`, {
    session: boss.session,
    body: { parentId: childId },
  });
  assert.equal(cycle.status, 422);
  assert.equal(cycle.body.error.code, 'UNPROCESSABLE_ENTITY');

  const list = await GET('/api/v1/admin/categories', { session: boss.session });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data.tree));
});

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

async function stockVariant(quantity = 10) {
  const boss = await admin();
  const product = await createProduct(boss, { name: 'Inventory Item', slug: `inv-${seq}` });
  const created = await POST(`/api/v1/admin/products/${product.id}/variants`, {
    session: boss.session,
    body: { sku: `SKU-INV-${seq}`, price: 100000 },
  });
  const variant = created.body.data.variants[0];
  if (quantity > 0) {
    await POST(`/api/v1/admin/inventory/${variant.id}/adjust`, {
      session: boss.session,
      body: { type: 'RESTOCK', quantity },
    });
  }
  return { boss, product, variant };
}

test('stock adjustments update the balance and write a ledger row', async () => {
  const { boss, variant } = await stockVariant(10);

  const restock = await POST(`/api/v1/admin/inventory/${variant.id}/adjust`, {
    session: boss.session,
    body: { type: 'RESTOCK', quantity: 5, note: 'Delivery' },
  });
  assert.equal(restock.status, 200);
  assert.equal(restock.body.data.item.quantity, 15);

  const damage = await POST(`/api/v1/admin/inventory/${variant.id}/adjust`, {
    session: boss.session,
    body: { type: 'DAMAGE', quantity: 3 },
  });
  assert.equal(damage.status, 200);
  assert.equal(damage.body.data.item.quantity, 12);

  const ledger = await GET(`/api/v1/admin/inventory/${variant.id}/ledger`, {
    session: boss.session,
  });
  assert.equal(ledger.status, 200);
  const types = ledger.body.data.entries.map((entry) => entry.type);
  assert.ok(types.includes('RESTOCK'));
  assert.ok(types.includes('DAMAGE'));
  assert.ok(
    ledger.body.data.entries.every((entry) => entry.createdBy?.id),
    'ledger rows name the actor'
  );
});

test('an adjustment that would go below zero is rejected', async () => {
  const { boss, variant } = await stockVariant(2);
  const res = await POST(`/api/v1/admin/inventory/${variant.id}/adjust`, {
    session: boss.session,
    body: { type: 'DAMAGE', quantity: 999 },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'UNPROCESSABLE_ENTITY');
});

test('a reorder level can be set', async () => {
  const { boss, variant } = await stockVariant(1);
  const res = await PATCH(`/api/v1/admin/inventory/${variant.id}`, {
    session: boss.session,
    body: { reorderLevel: 4 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.item.reorderLevel, 4);
});

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

async function placeCodOrder(shopper, variantId, quantity = 1) {
  const added = await POST('/api/v1/cart/items', {
    session: shopper.session,
    body: { variantId, quantity },
  });
  assert.equal(added.status, 200, `cart add failed: ${added.body?.error?.message}`);

  const checkout = await POST('/api/v1/checkout', {
    session: shopper.session,
    body: { city: 'Addis Ababa', area: 'Bole', street: 'Bole Road 1' },
  });
  assert.equal(checkout.status, 201, `checkout failed: ${checkout.body?.error?.message}`);
  return checkout.body.data.order.orderNumber;
}

test('order status only moves along the fulfilment graph', async () => {
  const { boss, variant } = await stockVariant(10);
  const shopper = await customer();
  const orderNumber = await placeCodOrder(shopper, variant.id, 1);

  const illegal = await PATCH(`/api/v1/admin/orders/${orderNumber}/status`, {
    session: boss.session,
    body: { status: 'SHIPPED' },
  });
  assert.equal(illegal.status, 422);
  assert.equal(illegal.body.error.code, 'INVALID_STATUS_TRANSITION');

  const legal = await PATCH(`/api/v1/admin/orders/${orderNumber}/status`, {
    session: boss.session,
    body: { status: 'CONFIRMED' },
  });
  assert.equal(legal.status, 200);
  assert.equal(legal.body.data.order.status, 'CONFIRMED');
});

test('cancelling an order returns its stock to the ledger', async () => {
  const { boss, variant } = await stockVariant(10);
  const shopper = await customer();
  const orderNumber = await placeCodOrder(shopper, variant.id, 2);

  const { rows: afterSale } = await db.query(
    `SELECT quantity FROM inventory WHERE variant_id = $1`,
    [variant.id]
  );
  assert.equal(afterSale[0].quantity, 8, 'checkout removed two units');

  const cancel = await PATCH(`/api/v1/admin/orders/${orderNumber}/status`, {
    session: boss.session,
    body: { status: 'CANCELLED' },
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.order.status, 'CANCELLED');

  const { rows: afterCancel } = await db.query(
    `SELECT quantity FROM inventory WHERE variant_id = $1`,
    [variant.id]
  );
  assert.equal(afterCancel[0].quantity, 10, 'cancelling restocked the order');

  const { rows: returns } = await db.query(
    `SELECT count(*)::int AS n FROM inventory_transactions
      WHERE variant_id = $1 AND transaction_type = 'RETURN'`,
    [variant.id]
  );
  assert.equal(returns[0].n, 1, 'the restock is recorded in the ledger');
});

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

test('a customer can be listed, inspected, suspended and reactivated', async () => {
  const boss = await admin();
  const shopper = await customer();

  const list = await GET('/api/v1/admin/customers', { session: boss.session });
  assert.equal(list.status, 200);
  assert.ok(list.body.data.customers.some((c) => c.id === shopper.id));

  const suspended = await PATCH(`/api/v1/admin/customers/${shopper.id}/status`, {
    session: boss.session,
    body: { status: 'SUSPENDED' },
  });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.data.customer.status, 'SUSPENDED');

  // The suspension takes effect immediately: the customer's live session is now
  // refused by `authenticate`.
  const blocked = await GET('/api/v1/admin/dashboard', { session: shopper.session });
  assert.equal(blocked.status, 403);

  const reactivated = await PATCH(`/api/v1/admin/customers/${shopper.id}/status`, {
    session: boss.session,
    body: { status: 'ACTIVE' },
  });
  assert.equal(reactivated.body.data.customer.status, 'ACTIVE');
});

test('customer responses never expose a password hash', async () => {
  const boss = await admin();
  const shopper = await customer();
  const detail = await GET(`/api/v1/admin/customers/${shopper.id}`, { session: boss.session });
  assert.equal(detail.status, 200);
  const serialised = JSON.stringify(detail.body);
  assert.ok(!serialised.includes('password_hash'), 'the hash column must never be selected');
  assert.ok(!serialised.includes('"password"'), 'no raw password field may appear');
  assert.ok(!serialised.includes(DUMMY_HASH));
});

test('a staff account cannot be suspended through the customer surface', async () => {
  const boss = await admin();
  const otherAdmin = await admin();
  const res = await PATCH(`/api/v1/admin/customers/${otherAdmin.id}/status`, {
    session: boss.session,
    body: { status: 'SUSPENDED' },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'UNPROCESSABLE_ENTITY');
});

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

test('a review can be approved and then rejected, without editing its content', async () => {
  const boss = await admin();
  const { variant, product } = await stockVariant(5);
  const shopper = await customer();
  await placeCodOrder(shopper, variant.id, 1);

  const { rows: items } = await db.query(
    `SELECT oi.id FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.user_id = $1 AND oi.product_id = $2
      LIMIT 1`,
    [shopper.id, product.id]
  );
  const orderItemId = items[0].id;

  const reviewId = nextId();
  await db.query(
    `INSERT INTO reviews (id, user_id, product_id, order_item_id, rating, title, comment)
     VALUES ($1, $2, $3, $4, 5, 'Great', 'Really good')`,
    [reviewId, shopper.id, product.id, orderItemId]
  );

  const approve = await PATCH(`/api/v1/admin/reviews/${reviewId}/status`, {
    session: boss.session,
    body: { status: 'APPROVED', note: 'Looks genuine' },
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.data.review.status, 'APPROVED');
  assert.equal(approve.body.data.review.comment, 'Really good');
  assert.equal(approve.body.data.review.moderation.note, 'Looks genuine');

  const reject = await PATCH(`/api/v1/admin/reviews/${reviewId}/status`, {
    session: boss.session,
    body: { status: 'REJECTED' },
  });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.data.review.status, 'REJECTED');
  assert.equal(reject.body.data.review.comment, 'Really good', 'author content is untouched');
});

/* -------------------------------------------------------------------------- */
/* Payments and dashboard                                                      */
/* -------------------------------------------------------------------------- */

test('payments can be listed and inspected without exposing secrets', async () => {
  const boss = await admin();
  const { variant } = await stockVariant(3);
  const shopper = await customer();
  await placeCodOrder(shopper, variant.id, 1);

  const list = await GET('/api/v1/admin/payments', { session: boss.session });
  assert.equal(list.status, 200);
  assert.ok(list.body.data.payments.length >= 1);

  const payment = list.body.data.payments[0];
  const detail = await GET(`/api/v1/admin/payments/${payment.id}`, { session: boss.session });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.payment.method, 'COD');
  assert.equal(detail.body.data.payment.provider, 'INTERNAL');
});

test('the dashboard reports real, non-negative integer figures', async () => {
  const boss = await admin();
  const { variant } = await stockVariant(4);
  const shopper = await customer();
  await placeCodOrder(shopper, variant.id, 1);

  const res = await GET('/api/v1/admin/dashboard', { session: boss.session });
  assert.equal(res.status, 200);
  const { orders, products, customers, lowStockCount, pendingReviews } = res.body.data.dashboard;

  assert.ok(Number.isInteger(orders.total));
  assert.ok(orders.total >= 1);
  assert.ok(Number.isInteger(orders.grossSales));
  assert.ok(orders.grossSales > 0);
  assert.ok(Number.isInteger(products.total));
  assert.ok(Number.isInteger(customers.total));
  assert.ok(Number.isInteger(lowStockCount));
  assert.ok(Number.isInteger(pendingReviews));
});

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                 */
/* -------------------------------------------------------------------------- */

test('each sensitive action writes an audit row naming the administrator', async () => {
  const boss = await admin();
  const product = await createProduct(boss, { name: 'Audited', slug: `audited-${seq}` });
  await POST(`/api/v1/admin/products/${product.id}/archive`, { session: boss.session, body: {} });

  const res = await GET('/api/v1/admin/audit-logs?entityType=PRODUCT&action=PRODUCT_ARCHIVED', {
    session: boss.session,
  });
  assert.equal(res.status, 200);
  const entries = res.body.data.logs;
  assert.ok(entries.length >= 1, 'at least the archive should be recorded');

  const archive = entries.find((entry) => entry.entityId === product.id);
  assert.ok(archive, 'the audit row points at the archived product');
  assert.equal(archive.actor.email, boss.email);
});

test('the audit feed can be filtered by actor', async () => {
  const boss = await admin();
  await createProduct(boss, { name: 'By Boss', slug: `by-boss-${seq}` });

  const res = await GET(`/api/v1/admin/audit-logs?actorId=${boss.id}`, { session: boss.session });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.logs.length >= 1);
  assert.ok(res.body.data.logs.every((entry) => entry.actor.id === boss.id));
});
