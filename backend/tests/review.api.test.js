/**
 * Customer review submission API tests (Phase 10).
 *
 * The write path is the newest surface and the one with the most at stake, so
 * what this file proves is mostly: the review is only possible when it was
 * EARNED.
 *
 *   1. A review must point at a purchased, delivered line owned by the
 *      reviewer. Anything else — someone else's order, a not-yet-delivered
 *      order, a guest order — is refused with 422 REVIEW_NOT_ELIGIBLE.
 *   2. The product is derived from the order line server-side. There is no way
 *      to submit a review for a product you did not buy: the body has no
 *      product_id field at all.
 *   3. Duplicates are refused the same way the schema refuses them — once per
 *      purchase line, and once per product — but with a readable 409 instead
 *      of a constraint error the client cannot act on.
 *   4. New reviews are PENDING. The public product read never sees them until
 *      an administrator approves the moderation.
 *   5. Only the reviewer's own history is reachable: `reviewable` is scoped to
 *      the session, and writing is protected by `authenticate`.
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

function nextId() {
  seq += 1;
  return `50000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
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

async function createProduct() {
  const categoryId = nextId();
  seq += 1;
  const productId = nextId();
  await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, $2, $3)`, [
    categoryId,
    `Category ${seq}`,
    `category-${seq}`,
  ]);
  await db.query(
    `INSERT INTO products (id, category_id, name, slug, description, product_type, brand, status)
     VALUES ($1, $2, $3, $4, $5, 'PHYSICAL', 'TestBrand', 'ACTIVE')`,
    [productId, categoryId, `Product ${seq}`, `product-${seq}`, 'A fixture product']
  );
  return { id: productId, categoryId, slug: `product-${seq}` };
}

async function createDeliveredOrder(userId, productId) {
  const orderId = nextId();
  const itemId = nextId();
  const orderNumber = `ORD-TEST-${seq}`;
  await db.query(
    `INSERT INTO orders
       (id, order_number, user_id, status, subtotal, delivery_fee, discount_total, total,
        payment_status, payment_method, customer_email, customer_phone, shipping_address_snapshot)
     VALUES ($1, $2, $3, 'DELIVERED', 10000, 5000, 0, 15000,
        'PAID', 'COD', 'shopper@example.com', '0911223344', '{"full_name":"Shopper","city":"AA"}')`,
    [orderId, orderNumber, userId]
  );
  await db.query(
    `INSERT INTO order_items
       (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
     VALUES ($1, $2, $3, 'Fixtured product', 10000, 1, 10000)`,
    [itemId, orderId, productId]
  );
  return { orderId, itemId, orderNumber };
}

function req(method, path, { session, body, origin = ORIGIN } = {}) {
  let r = request(app)[method](path);
  if (origin) r = r.set('Origin', origin);
  if (session) r = r.set('Cookie', session.raw);
  if (body !== undefined) r = r.send(body);
  return r;
}

const GET = (path, opts) => req('get', path, opts);
const POST = (path, opts) => req('post', path, opts);

/* -------------------------------------------------------------------------- */
/* The happy path                                                              */
/* -------------------------------------------------------------------------- */

test('a buyer of a delivered order can fetch and submit a review', async () => {
  const shopper = await createUser({ tag: 'buyer' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const { itemId } = await createDeliveredOrder(shopper.id, product.id);

  const reviewable = await GET('/api/v1/reviews/reviewable', { session });
  assert.equal(reviewable.status, 200);
  assert.equal(reviewable.body.success, true);
  assert.equal(reviewable.body.data.items.length, 1);
  assert.equal(reviewable.body.data.items[0].orderItemId, itemId);
  assert.equal(reviewable.body.data.items[0].product.id, product.id);
  assert.equal(reviewable.body.data.items[0].product.slug, product.slug);

  const created = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 5, title: 'Really good', comment: 'It arrived fast.' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.review.rating, 5);
  assert.equal(created.body.data.review.title, 'Really good');
  assert.equal(created.body.data.review.author, shopper.name);
  assert.equal(created.body.data.review.is_verified_purchase, true);
  assert.equal(created.body.data.review.status, 'PENDING');
  assert.equal(created.body.data.review.product.id, product.id);

  // Done with it — the same purchase is no longer offered.
  const afterwards = await GET('/api/v1/reviews/reviewable', { session });
  assert.equal(afterwards.body.data.items.length, 0);
});

test('a submitted review is PENDING and invisible to the public product read', async () => {
  const shopper = await createUser({ tag: 'discreet' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const { itemId } = await createDeliveredOrder(shopper.id, product.id);

  await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 2, title: 'Meh', comment: 'Never again.' },
  });

  const publicRead = await GET(`/api/v1/products/${product.slug}/reviews`);
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.data.reviews.length, 0);
  assert.equal(publicRead.body.data.rating.count, 0);
});

/* -------------------------------------------------------------------------- */
/* Eligibility is earned, not asserted                                          */
/* -------------------------------------------------------------------------- */

test('another shopper order item is not reviewable and is refused on submit', async () => {
  const owner = await createUser({ tag: 'owner' });
  const other = await createUser({ tag: 'other' });
  const otherSession = await createSession(other.id);
  const product = await createProduct();
  const { itemId } = await createDeliveredOrder(owner.id, product.id);

  const reviewable = await GET('/api/v1/reviews/reviewable', { session: otherSession });
  assert.equal(reviewable.status, 200);
  assert.equal(reviewable.body.data.items.length, 0);

  const refused = await POST('/api/v1/reviews', {
    session: otherSession,
    body: { order_item_id: itemId, rating: 4, title: 'Nope', comment: '' },
  });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'REVIEW_NOT_ELIGIBLE');
});

test('a not-yet-delivered order cannot be reviewed', async () => {
  const shopper = await createUser({ tag: 'impatient' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const orderId = nextId();
  const itemId = nextId();
  await db.query(
    `INSERT INTO orders
       (id, order_number, user_id, status, subtotal, delivery_fee, discount_total, total,
        payment_status, payment_method, customer_email, customer_phone, shipping_address_snapshot)
     VALUES ($1, $2, $3, 'PROCESSING', 10000, 5000, 0, 15000,
        'PENDING', 'COD', 'shopper@example.com', '0911223344', '{"full_name":"Shopper","city":"AA"}')`,
    [orderId, `ORD-TEST-${seq}`, shopper.id]
  );
  await db.query(
    `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
     VALUES ($1, $2, $3, 'Fixtured product', 10000, 1, 10000)`,
    [itemId, orderId, product.id]
  );

  const reviewable = await GET('/api/v1/reviews/reviewable', { session });
  assert.equal(reviewable.body.data.items.length, 0);

  const refused = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 3, title: 'Soon', comment: '' },
  });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'REVIEW_NOT_ELIGIBLE');
});

test('a guest order can never be reviewed (it has no owner to prove the purchase)', async () => {
  const shopper = await createUser({ tag: 'guest-neighbour' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const itemId = nextId();
  const orderId = nextId();
  await db.query(
    `INSERT INTO orders
       (id, order_number, user_id, status, subtotal, delivery_fee, discount_total, total,
        payment_status, payment_method, customer_email, customer_phone, shipping_address_snapshot)
     VALUES ($1, $2, NULL, 'DELIVERED', 10000, 5000, 0, 15000,
        'PAID', 'COD', 'guest@example.com', '0911223344', '{"full_name":"Guest","city":"AA"}')`,
    [orderId, `ORD-TEST-${seq}`]
  );
  await db.query(
    `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, subtotal)
     VALUES ($1, $2, $3, 'Fixtured product', 10000, 1, 10000)`,
    [itemId, orderId, product.id]
  );

  const refused = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 3, title: 'Owned', comment: '' },
  });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'REVIEW_NOT_ELIGIBLE');
});

/* -------------------------------------------------------------------------- */
/* Duplicates — once per purchase, once per product                            */
/* -------------------------------------------------------------------------- */

test('the same purchase line cannot be reviewed twice (409)', async () => {
  const shopper = await createUser({ tag: 'repeater' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const { itemId } = await createDeliveredOrder(shopper.id, product.id);

  const first = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 4, title: 'First', comment: '' },
  });
  assert.equal(first.status, 201);

  const second = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 5, title: 'Second', comment: '' },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'REVIEW_ALREADY_SUBMITTED');
});

test('a product bought again in a later order is still one review (409)', async () => {
  const shopper = await createUser({ tag: 'repeat-buyer' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const first = await createDeliveredOrder(shopper.id, product.id);
  const second = await createDeliveredOrder(shopper.id, product.id);

  const ok = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: first.itemId, rating: 4, title: 'Once', comment: '' },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const reviewable = await GET('/api/v1/reviews/reviewable', { session });
  assert.equal(reviewable.body.data.items.length, 0, 'the second purchase is not offered');

  const refused = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: second.itemId, rating: 2, title: 'Twice', comment: '' },
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'REVIEW_ALREADY_SUBMITTED');
});

/* -------------------------------------------------------------------------- */
/* Security — the review is anchored to identity                               */
/* -------------------------------------------------------------------------- */

test('guest and anonymous writes are refused before any rule runs', async () => {
  const result = await POST('/api/v1/reviews', {
    session: undefined,
    body: {
      order_item_id: '00000000-0000-4000-8000-000000000000',
      rating: 5,
      title: 'x',
      comment: '',
    },
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHORIZED');
});

test('a four-star with no words is a validation error, not a review', async () => {
  const shopper = await createUser({ tag: 'wordless' });
  const session = await createSession(shopper.id);
  const product = await createProduct();
  const { itemId } = await createDeliveredOrder(shopper.id, product.id);

  const result = await POST('/api/v1/reviews', {
    session,
    body: { order_item_id: itemId, rating: 4, title: '   ', comment: '' },
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');
});

test('a body that names its own product has no power to aim the review', async () => {
  const shopper = await createUser({ tag: 'hacker' });
  const session = await createSession(shopper.id);
  const victim = await createProduct();
  const { itemId } = await createDeliveredOrder(shopper.id, victim.id);
  const stranger = await createProduct();

  const result = await POST('/api/v1/reviews', {
    session,
    body: {
      order_item_id: itemId,
      product_id: stranger.id,
      rating: 5,
      title: 'Misdirected',
      comment: '',
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.review.product.id, victim.id, 'the derived product wins');
});
