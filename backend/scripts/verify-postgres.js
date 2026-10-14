/**
 * Real-PostgreSQL verification (Phase 12).
 *
 * The automated test suite runs against PGlite — PostgreSQL compiled to WebAssembly
 * — so it needs no server and stays fast. This script is the complementary check
 * against a real, networked PostgreSQL server. It confirms that:
 *
 *   1. the server is a supported version;
 *   2. all migrations apply cleanly and every table exists;
 *   3. the indexes and constraints from the hardening migration exist;
 *   4. the schema actually rejects bad data (coupon cap, category cycles);
 *   5. the oversell guard holds under genuine concurrent connections.
 *
 * Run it against a throwaway or staging database, never production: the stock
 * check briefly commits one throwaway product and deletes it again afterwards.
 *
 *   npm run verify:db
 *   # or
 *   DATABASE_URL=postgres://user:pass@host:5432/db \
 *     node backend/scripts/verify-postgres.js
 *
 * Exit code 0 means every check passed.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';

/** Tables every migration set creates. */
const REQUIRED_TABLES = [
  'addresses',
  'audit_logs',
  'cart_items',
  'carts',
  'categories',
  'coupons',
  'inventory',
  'inventory_transactions',
  'order_items',
  'orders',
  'payments',
  'product_images',
  'product_variants',
  'products',
  'reviews',
  'user_sessions',
  'users',
  'wishlist_items',
  'wishlists',
];

/** Indexes the query workload and foreign-key maintenance depend on. */
const REQUIRED_INDEXES = [
  'idx_products_active_created_at',
  'idx_products_status_category_id',
  'idx_reviews_product_id',
  'idx_reviews_moderated_by',
  'idx_inventory_transactions_created_by',
  'idx_carts_merged_into_cart_id',
  'idx_carts_one_active_per_user',
  'idx_orders_user_id',
  'idx_user_sessions_user_id',
  'idx_coupons_active_window',
];

const failures = [];

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(label);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  return ok;
}

/** Runs the migration runner (a child process) against the configured database. */
function migrate() {
  const runner = fileURLToPath(new URL('../migrations/run.js', import.meta.url));
  const result = spawnSync(process.execPath, [runner, 'up'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('migration run failed');
}

/** Removes every row this script could have created. Safe to call repeatedly. */
async function cleanup() {
  await pool.query(`DELETE FROM products WHERE slug LIKE 'zz-verify-%'`);
  await pool.query(`DELETE FROM categories WHERE slug LIKE 'zz-verify-%'`);
  await pool.query(`DELETE FROM coupons WHERE code = 'ZZVERIFYOVER'`);
}

async function main() {
  console.log('--- Real PostgreSQL verification ---------------------------------\n');

  const { rows: versionRows } = await pool.query('SHOW server_version_num');
  const versionNum = Number(versionRows[0].server_version_num);
  const major = Math.floor(versionNum / 10_000);
  check(`PostgreSQL ${major} >= 13 (supported)`, major >= 13, `server_version_num=${versionNum}`);

  console.log('\nApplying migrations...');
  migrate();

  // --- Schema and objects -------------------------------------------------
  const { rows: tableRows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const tables = new Set(tableRows.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  check('every required table exists', missingTables.length === 0, missingTables.join(', '));
  check('schema_migrations tracking table exists', tables.has('schema_migrations'));

  const { rows: indexRows } = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
  );
  const indexes = new Set(indexRows.map((row) => row.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.has(name));
  check('required indexes exist', missingIndexes.length === 0, missingIndexes.join(', '));

  const { rows: constraintRows } = await pool.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'coupons_used_within_max'`
  );
  check('coupons_used_within_max constraint exists', constraintRows.length === 1);

  // --- Behaviour under real data -----------------------------------------
  await cleanup();

  try {
    let couponRejected = false;
    try {
      await pool.query(
        `INSERT INTO coupons (code, discount_type, discount_value, max_uses, used_count)
         VALUES ('ZZVERIFYOVER', 'FIXED', 100, 1, 2)`
      );
    } catch (error) {
      couponRejected = /coupons_used_within_max|check/i.test(error.message);
    }
    check('a coupon over its cap is rejected', couponRejected);

    const { rows: catA } = await pool.query(
      `INSERT INTO categories (name, slug) VALUES ('ZZ Verify Root', 'zz-verify-root') RETURNING id`
    );
    const { rows: catB } = await pool.query(
      `INSERT INTO categories (name, slug, parent_id)
       VALUES ('ZZ Verify Child', 'zz-verify-child', $1) RETURNING id`,
      [catA[0].id]
    );
    let cycleRejected = false;
    try {
      await pool.query(`UPDATE categories SET parent_id = $1 WHERE id = $2`, [
        catB[0].id,
        catA[0].id,
      ]);
    } catch (error) {
      cycleRejected = /cycle|check/i.test(error.message);
    }
    check('a category cycle is rejected by the trigger', cycleRejected);

    const { rows: product } = await pool.query(
      `INSERT INTO products (name, slug, status)
       VALUES ('ZZ Verify Widget', 'zz-verify-widget', 'ACTIVE') RETURNING id`
    );
    const { rows: variant } = await pool.query(
      `INSERT INTO product_variants (product_id, sku, price)
       VALUES ($1, 'ZZ-VERIFY-SKU', 1000) RETURNING id`,
      [product[0].id]
    );
    await pool.query(`INSERT INTO inventory (variant_id, quantity) VALUES ($1, 1)`, [
      variant[0].id,
    ]);

    const { deduct } = await import('../src/repositories/inventory.repository.js');
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => deduct({}, variant[0].id, 1))
    );
    const winners = attempts.filter(Boolean).length;
    check(
      'exactly one of six concurrent deductions wins the last unit',
      winners === 1,
      `winners=${winners}`
    );

    const { rows: stock } = await pool.query(
      `SELECT quantity FROM inventory WHERE variant_id = $1`,
      [variant[0].id]
    );
    check(
      'stock never goes negative',
      Number(stock[0].quantity) === 0,
      `quantity=${stock[0].quantity}`
    );
  } finally {
    await cleanup();
  }

  console.log('\n------------------------------------------------------------------');
  if (failures.length) {
    console.log(`${failures.length} check(s) FAILED.`);
    failures.forEach((name) => console.log(`  - ${name}`));
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}

main()
  .catch((error) => {
    logger.error('Verification failed to run', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
