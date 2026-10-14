/**
 * Phase 11 schema hardening: the indexes the query workload relies on, and the
 * coupon integrity rule added in migration 024.
 *
 * The indexes are asserted via `to_regclass`, which resolves a relation name to
 * its OID or NULL — a direct "does this index exist?" check that does not depend
 * on any particular catalogue view being available.
 */
import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedDb, expectRejected } from './helpers/database.js';

let db;

before(async () => {
  db = await createMigratedDb();
});

after(async () => {
  await db?.close();
});

const HARDENING_INDEXES = [
  'idx_products_active_created_at',
  'idx_reviews_moderated_by',
  'idx_inventory_transactions_created_by',
  'idx_carts_merged_into_cart_id',
];

test('migration 024 creates every hardening index', async () => {
  for (const name of HARDENING_INDEXES) {
    const { rows } = await db.query('SELECT to_regclass($1) AS relation', [`public.${name}`]);
    assert.ok(rows[0].relation, `expected index ${name} to exist`);
  }
});

test('a coupon cannot be used more times than its lifetime cap', async () => {
  await expectRejected(
    db,
    `INSERT INTO coupons (code, discount_type, discount_value, max_uses, used_count)
     VALUES ('OVERUSED', 'FIXED', 1000, 1, 2)`,
    [],
    /coupons_used_within_max|check/i
  );
});

test('a coupon at its cap is allowed, and lowering the cap below use is refused', async () => {
  const { rows } = await db.query(
    `INSERT INTO coupons (code, discount_type, discount_value, max_uses, used_count)
     VALUES ('ATCAP', 'FIXED', 1000, 2, 2)
     RETURNING id`
  );
  const { id } = rows[0];

  await expectRejected(
    db,
    `UPDATE coupons SET max_uses = 1 WHERE id = $1`,
    [id],
    /coupons_used_within_max|check/i
  );
});

test('an uncapped coupon places no ceiling on used_count', async () => {
  await db.query(
    `INSERT INTO coupons (code, discount_type, discount_value, max_uses, used_count)
     VALUES ('UNLIMITED', 'FIXED', 1000, NULL, 9999)`
  );
});
