/**
 * Wishlist API tests (Phase 7).
 *
 * The wishlist is authenticated-only: there is no guest server-side list
 * (guests keep their saved items in the browser until sign-in). These tests
 * pin the auth boundary, duplicate prevention, the merge endpoint that folds
 * a guest's local list into the customer list, and the identity scoping.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';

const SESSION = 'ecom_session';

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
  return `21000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

async function makeProduct({ status = 'ACTIVE' } = {}) {
  const productId = nextId();
  await db.query(
    `INSERT INTO products (id, name, slug, product_type, status)
     VALUES ($1, $2, $3, 'PHYSICAL', $4)`,
    [productId, `Wishlist Fixture ${seq}`, `wishlist-fixture-${seq}`, status]
  );
  return String(productId);
}

function sessionValue(res) {
  const headers = res.headers['set-cookie'] ?? [];
  const list = Array.isArray(headers) ? headers : [headers];
  const entry = list.find((cookie) => cookie.startsWith(`${SESSION}=`));
  return entry ? { raw: entry } : null;
}

async function createShopper(tag = 'shopper') {
  emailSeq += 1;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: 'Wishlist Tester',
      email: `${tag}-${emailSeq}@example.com`,
      phone: '0911556677',
      password: 'StrongPass1!',
      passwordConfirmation: 'StrongPass1!',
    });
  assert.equal(res.status, 201, `register should succeed: ${res.body?.error?.message}`);
  const session = sessionValue(res);
  return { session: session.raw };
}

/* -------------------------------------------------------------------------- */
/* Auth boundary                                                               */
/* -------------------------------------------------------------------------- */

test('the wishlist API requires a signed-in shopper (401 without a session)', async () => {
  const response = await request(app).get('/api/v1/wishlist');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('the first authenticated read lazily creates the wishlist', async () => {
  const { session } = await createShopper('lazy');

  const res = await request(app)
    .get('/api/v1/wishlist')
    .set('Cookie', session);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.wishlist.name, 'My Wishlist');
  assert.deepEqual(res.body.data.wishlist.items, []);
  assert.equal(res.body.data.wishlist.count, 0);

  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM wishlists`);
  assert.equal(rows[0].n, 1);
});

/* -------------------------------------------------------------------------- */
/* Add / list / remove                                                         */
/* -------------------------------------------------------------------------- */

test('saving a product adds it; saving again is idempotent and cannot duplicate', async () => {
  const { session } = await createShopper('save');
  const productId = await makeProduct();

  const first = await request(app)
    .post('/api/v1/wishlist/items')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productId });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.wishlist.items.length, 1);
  assert.equal(first.body.data.wishlist.items[0].productId, productId);

  const second = await request(app)
    .post('/api/v1/wishlist/items')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productId });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.wishlist.items.length, 1, 'duplicate save is a no-op');

  const list = await request(app).get('/api/v1/wishlist').set('Cookie', session);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.wishlist.count, 1);
});

test('removing a saved product works, and removing again is idempotent', async () => {
  const { session } = await createShopper('remove');
  const productId = await makeProduct();

  await request(app)
    .post('/api/v1/wishlist/items')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productId });

  for (let i = 0; i < 2; i += 1) {
    const res = await request(app)
      .delete(`/api/v1/wishlist/items/${productId}`)
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', session);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.wishlist.items, []);
  }
});

test('an unknown or archived product cannot be saved', async () => {
  const { session } = await createShopper('badproduct');
  const archived = await makeProduct({ status: 'ARCHIVED' });
  const unknown = '00000000-0000-4000-8000-000000000000';

  const unknownRes = await request(app)
    .post('/api/v1/wishlist/items')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productId: unknown });
  assert.equal(unknownRes.status, 404);
  assert.equal(unknownRes.body.error.code, 'PRODUCT_NOT_FOUND');

  const archivedRes = await request(app)
    .post('/api/v1/wishlist/items')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productId: archived });
  assert.equal(archivedRes.status, 404);
});

test('wishlists are scoped per shopper: one shopper cannot touch anothers list', async () => {
  const { session: aSession } = await createShopper('scope-a');
  const { session: bSession } = await createShopper('scope-b');
  const productId = await makeProduct();

  await request(app)
    .post('/api/v1/wishlist/items')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', aSession)
    .send({ productId });

  // Shopper B cannot delete from A's list (the row is not theirs) and never
  // even sees it.
  const bDelete = await request(app)
    .delete(`/api/v1/wishlist/items/${productId}`)
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', bSession);
  assert.equal(bDelete.status, 200);
  assert.equal(bDelete.body.data.wishlist.count, 0, "B's delete only touches B's list");

  const aList = await request(app).get('/api/v1/wishlist').set('Cookie', aSession);
  assert.equal(aList.body.data.wishlist.count, 1, "A's item survives B's unrelated delete");
});

/* -------------------------------------------------------------------------- */
/* Merge after login                                                           */
/* -------------------------------------------------------------------------- */

test('merge folds the guest local list in, skipping archived products, idempotently', async () => {
  const { session } = await createShopper('merge');
  const live = await makeProduct();
  const alsoLive = await makeProduct();
  const archived = await makeProduct({ status: 'ARCHIVED' });
  const unknown = '00000000-0000-4000-8000-000000000000';

  const first = await request(app)
    .post('/api/v1/wishlist/merge')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productIds: [live, alsoLive, archived, unknown, live] });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.wishlist.count, 2, 'duplicates plus dead ids collapse correctly');
  assert.equal(first.body.data.wishlist.added, 2);
  assert.equal(first.body.data.wishlist.skipped, 2, 'archived + unknown are skipped, not errors');

  const again = await request(app)
    .post('/api/v1/wishlist/merge')
    .set('Origin', 'http://localhost:5173')
    .set('Cookie', session)
    .send({ productIds: [live, alsoLive] });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.wishlist.count, 2, 'merging again adds nothing new');
  assert.equal(again.body.data.wishlist.added, 0);
});

test('merge without product ids is a validation error', async () => {
  const { session } = await createShopper('merge-empty');
  for (const body of [{}, { productIds: [] }, { productIds: ['nope'] }]) {
    const res = await request(app)
      .post('/api/v1/wishlist/merge')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', session)
      .send(body);
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});