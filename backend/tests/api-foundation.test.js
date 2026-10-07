import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMigratedDb } from './helpers/database.js';
import { closePool } from '../src/config/db.js';

let app;
let db;

test.before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
});

test.after(async () => {
  await closePool();
  if (db) await db.close();
});

test('unknown routes return a 404 envelope', async () => {
  const response = await request(app).get('/api/v1/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.equal(typeof response.body.error.message, 'string');
});

// Phase 5 implemented the public catalogue; Phase 6 added customer auth and
// Phase 7 added the customer cart + wishlist. The rest are still ahead.
// Keeping the placeholder list in step with `routes/v1.routes.js` is what stops
// a route from silently disappearing: if one is implemented and forgotten
// here, this fails.
const IMPLEMENTED = new Set(['products', 'categories', 'search', 'auth', 'cart', 'wishlist']);

const RESOURCE_PATHS = [
  '/api/v1/auth',
  '/api/v1/products',
  '/api/v1/categories',
  '/api/v1/cart',
  '/api/v1/wishlist',
  '/api/v1/orders',
  '/api/v1/payments',
  '/api/v1/reviews',
  '/api/v1/users',
  '/api/v1/admin',
].filter((path) => !IMPLEMENTED.has(path.split('/').pop()));

for (const path of RESOURCE_PATHS) {
  test(`${path} is mounted and reports NOT_IMPLEMENTED`, async () => {
    const response = await request(app).get(path);

    assert.equal(response.status, 501);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'NOT_IMPLEMENTED');
    assert.match(response.body.error.message, /not implemented yet/i);
  });
}

// Auth is implemented in Phase 6, so `/api/v1/auth` needs a registered
// session — its placeholders are gone. Asserting the removal keeps this file in
// step with the versioned router.
test('GET /api/v1/auth (bare) is not a placeholder 501 anymore', async () => {
  const response = await request(app).get('/api/v1/auth');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});

// Phase 7 replaced the cart and wishlist placeholders with real routes; the
// bare cart endpoint serves a fresh guest cart instead of a 501, and the
// wishlist demands a signed-in shopper.
test('GET /api/v1/cart (bare) is not a placeholder 501 anymore', async () => {
  const response = await request(app).get('/api/v1/cart');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.cart.owner, 'guest');
});

test('GET /api/v1/wishlist (bare) is not a placeholder 501 anymore', async () => {
  const response = await request(app).get('/api/v1/wishlist');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('unknown method on a known resource still reports NOT_IMPLEMENTED', async () => {
  const response = await request(app).post('/api/v1/orders').send({ productId: 'x' });

  assert.equal(response.status, 501);
  assert.equal(response.body.error.code, 'NOT_IMPLEMENTED');
});

test('malformed JSON produces a safe 400-style error, not a crash', async () => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email":');

  assert.ok(response.status >= 400);
  assert.equal(response.body.success, false);
  assert.equal(typeof response.body.error.code, 'string');
});
