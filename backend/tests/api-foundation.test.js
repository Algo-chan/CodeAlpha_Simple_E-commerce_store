import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/config/db.js';

const app = createApp();

test.after(async () => {
  await closePool();
});

test('unknown routes return a 404 envelope', async () => {
  const response = await request(app).get('/api/v1/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.equal(typeof response.body.error.message, 'string');
});

// Phase 5 implemented the public catalogue; the rest are still ahead. Keeping the
// placeholder list in step with `routes/v1.routes.js` is what stops a route from
// silently disappearing: if one is implemented and forgotten here, this fails.
const IMPLEMENTED = new Set(['products', 'categories', 'search']);

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

test('unknown method on a known resource still reports NOT_IMPLEMENTED', async () => {
  const response = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com' });

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
