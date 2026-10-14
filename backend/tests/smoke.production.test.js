/**
 * Production smoke test (Phase 12).
 *
 * One file that walks the three journeys a release cares about, end to end,
 * through the real HTTP stack and a real PostgreSQL engine (PGlite):
 *
 *   Guest      browse catalogue → category → product → variant → cart →
 *              checkout (COD) → order number
 *   Customer   register → login → browse → cart → checkout → order history
 *   Admin      login → dashboard → create catalogue → stock → order status
 *
 * This is the last line of defence, not a unit test: if it passes, the wiring
 * between routing, validation, sessions, CSRF, transactions, inventory and the
 * response envelope is intact. It writes only to the in-memory database.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/password.js';

const ORIGIN = 'http://localhost:5173';
const ADMIN_EMAIL = 'smoke-admin@example.com';
const ADMIN_PASSWORD = 'AdminPass1!';
const CUSTOMER_EMAIL = 'smoke-customer@example.com';
const CUSTOMER_PASSWORD = 'CustomerPass1!';

let db;
let app;
/** Admin session cookie, established by the login test. */
let adminSession;
/** The stocked variant created by the admin test. */
let variantId;
/** The order number produced by the customer checkout test. */
let customerOrderNumber;

/** The raw `name=value` cookie from a response, or null. */
function cookie(res, name) {
  const headers = res.headers['set-cookie'] ?? [];
  const list = Array.isArray(headers) ? headers : [headers];
  const entry = list.find((value) => value.startsWith(`${name}=`));
  return entry ? entry.slice(0, entry.indexOf(';')) : null;
}

test.before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });

  // There is deliberately no way to register an administrator, so the fixture
  // is inserted directly — but with a real bcrypt hash, so the login test below
  // exercises the genuine credential path.
  await db.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE')`,
    ['Smoke Admin', ADMIN_EMAIL, '0911000000', await hashPassword(ADMIN_PASSWORD)]
  );
});

test.after(async () => {
  await db?.close();
});

/* -------------------------------------------------------------------------- */
/* Admin sets the stage                                                        */
/* -------------------------------------------------------------------------- */

test('admin logs in and reaches the dashboard', async () => {
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  assert.equal(login.status, 200, JSON.stringify(login.body));
  adminSession = cookie(login, 'ecom_session');
  assert.ok(adminSession, 'login sets a session cookie');

  const dashboard = await request(app).get('/api/v1/admin/dashboard').set('Cookie', adminSession);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.success, true);
});

test('admin creates a stocked, browseable product', async () => {
  const categoryRes = await request(app)
    .post('/api/v1/admin/categories')
    .set('Origin', ORIGIN)
    .set('Cookie', adminSession)
    .send({ name: 'Smoke Category', slug: 'smoke-category' });
  assert.equal(categoryRes.status, 201, JSON.stringify(categoryRes.body));

  const productRes = await request(app)
    .post('/api/v1/admin/products')
    .set('Origin', ORIGIN)
    .set('Cookie', adminSession)
    .send({
      name: 'Smoke Widget',
      slug: 'smoke-widget',
      productType: 'PHYSICAL',
      status: 'ACTIVE',
      categoryId: categoryRes.body.data.category.id,
    });
  assert.equal(productRes.status, 201, JSON.stringify(productRes.body));
  const product = productRes.body.data.product;

  const variantRes = await request(app)
    .post(`/api/v1/admin/products/${product.id}/variants`)
    .set('Origin', ORIGIN)
    .set('Cookie', adminSession)
    .send({ sku: 'SMOKE-WIDGET-1', price: 100000, attributes: { colour: 'Black' } });
  assert.equal(variantRes.status, 201, JSON.stringify(variantRes.body));
  variantId = variantRes.body.data.variants[0].id;

  const imageRes = await request(app)
    .post(`/api/v1/admin/products/${product.id}/images`)
    .set('Origin', ORIGIN)
    .set('Cookie', adminSession)
    .send({ imageUrl: 'https://cdn.example.com/smoke-widget.png', altText: 'Smoke Widget' });
  assert.equal(imageRes.status, 201, JSON.stringify(imageRes.body));

  const stockRes = await request(app)
    .post(`/api/v1/admin/inventory/${variantId}/adjust`)
    .set('Origin', ORIGIN)
    .set('Cookie', adminSession)
    .send({ type: 'RESTOCK', quantity: 5, note: 'Opening stock' });
  assert.equal(stockRes.status, 200, JSON.stringify(stockRes.body));
  assert.equal(stockRes.body.data.item.quantity, 5);
});

/* -------------------------------------------------------------------------- */
/* Guest journey                                                               */
/* -------------------------------------------------------------------------- */

test('guest browses home → category → product → variant', async () => {
  const home = await request(app).get('/api/v1/products?limit=10');
  assert.equal(home.status, 200);
  assert.ok(
    home.body.data.products.some((product) => product.slug === 'smoke-widget'),
    'the product appears on the home listing'
  );

  const category = await request(app).get('/api/v1/categories/smoke-category');
  assert.equal(category.status, 200);
  assert.equal(category.body.data.category.slug, 'smoke-category');
  assert.ok(
    category.body.data.products.some((product) => product.slug === 'smoke-widget'),
    'the product is listed under its category'
  );

  const detail = await request(app).get('/api/v1/products/smoke-widget');
  assert.equal(detail.status, 200);
  const variant = detail.body.data.product.variants[0];
  assert.equal(variant.sku, 'SMOKE-WIDGET-1');
  assert.equal(variant.id, variantId, 'the browsed variant is the stocked one');
});

test('guest adds to cart and checks out with COD', async () => {
  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .send({ variantId, quantity: 2 });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.data.cart.count, 2);

  const cartCookie = cookie(add, 'ecom_cart');
  assert.ok(cartCookie, 'the guest receives a cart cookie');

  const checkout = await request(app)
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Cookie', cartCookie)
    .send({
      full_name: 'Guest Buyer',
      email: 'guest@example.com',
      phone: '0911223344',
      city: 'Addis Ababa',
      area: 'Bole',
      street: 'Bole Road 1',
      payment_method: 'COD',
    });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));

  const order = checkout.body.data.order;
  assert.match(order.orderNumber, /^ORD-\d{8}-\d{4}$/);
  assert.equal(order.status, 'PENDING');
  assert.equal(order.paymentMethod, 'COD');
  assert.equal(order.subtotal, 200000);
  assert.equal(order.total, order.subtotal + order.deliveryFee);

  const { rows } = await db.query(`SELECT quantity FROM inventory WHERE variant_id = $1`, [
    variantId,
  ]);
  assert.equal(rows[0].quantity, 3, 'two units were deducted from stock');
});

test('customer registers, logs in, browses, orders and sees history', async () => {
  const register = await request(app).post('/api/v1/auth/register').send({
    name: 'Smoke Customer',
    email: CUSTOMER_EMAIL,
    phone: '0911556677',
    password: CUSTOMER_PASSWORD,
    passwordConfirmation: CUSTOMER_PASSWORD,
  });
  assert.equal(register.status, 201, JSON.stringify(register.body));

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const session = cookie(login, 'ecom_session');
  assert.ok(session, 'login returns a session cookie');

  const browse = await request(app).get('/api/v1/products/smoke-widget');
  assert.equal(browse.status, 200);

  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .set('Cookie', session)
    .send({ variantId, quantity: 1 });
  assert.equal(add.status, 200, JSON.stringify(add.body));

  const checkout = await request(app)
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Cookie', session)
    .send({
      city: 'Addis Ababa',
      area: 'Kirkos',
      street: 'Ring Road 5',
      payment_method: 'COD',
    });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  customerOrderNumber = checkout.body.data.order.orderNumber;

  const history = await request(app).get('/api/v1/orders').set('Cookie', session);
  assert.equal(history.status, 200);
  const numbers = (history.body.data.orders ?? []).map((order) => order.orderNumber);
  assert.ok(numbers.includes(customerOrderNumber), 'the order appears in the customer history');
});

test('admin sees the order and moves it forward', async () => {
  assert.ok(adminSession, 'the admin is signed in');
  assert.ok(customerOrderNumber, 'a customer order exists');

  const list = await request(app).get('/api/v1/admin/orders').set('Cookie', adminSession);
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data.orders));
  assert.ok(list.body.meta.pagination, 'the order list is paginated');

  const inventory = await request(app).get('/api/v1/admin/inventory').set('Cookie', adminSession);
  assert.equal(inventory.status, 200);
  assert.equal(inventory.body.success, true);

  const update = await request(app)
    .patch(`/api/v1/admin/orders/${customerOrderNumber}/status`)
    .set('Origin', ORIGIN)
    .set('Cookie', adminSession)
    .send({ status: 'CONFIRMED', note: 'Smoke test' });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  assert.equal(update.body.data.order.status, 'CONFIRMED');
});
