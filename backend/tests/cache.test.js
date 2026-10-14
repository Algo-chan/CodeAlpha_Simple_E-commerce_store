/**
 * Cache policy (Phase 11 hardening).
 *
 * The API is default-deny: every response is `no-store` unless a route opts into
 * public caching. This is what keeps one customer's cart, orders or session
 * state out of a shared cache. These tests pin both halves: the authenticated
 * default, and the explicit public override on the catalogue routes.
 */
import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';

let db;
let app;

before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
});

after(async () => {
  await db?.close();
});

test('an authenticated resource defaults to no-store', async () => {
  // Unauthenticated, so this is a 401 — but the cache header is set before the
  // auth check and applies to the response either way.
  const res = await request(app).get('/api/v1/orders');

  assert.equal(res.status, 401);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('an unknown API route is still no-store', async () => {
  const res = await request(app).get('/api/v1/not-a-thing');

  assert.equal(res.headers['cache-control'], 'no-store');
});

test('the public product listing opts into shared caching', async () => {
  const res = await request(app).get('/api/v1/products');

  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /^public/);
  assert.match(res.headers['cache-control'], /max-age=60/);
});

test('a public category list opts into public caching', async () => {
  const res = await request(app).get('/api/v1/categories');

  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /^public/);
});

test('a public search result is cacheable, still bounded', async () => {
  const res = await request(app).get('/api/v1/search').query({ q: 'anything' });

  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /^public, max-age=\d+/);
});
