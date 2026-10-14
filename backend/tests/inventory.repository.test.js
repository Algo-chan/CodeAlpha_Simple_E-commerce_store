/**
 * Inventory concurrency guard (Phase 11 hardening).
 *
 * The oversell defence is a single conditional UPDATE:
 *
 *   UPDATE inventory SET quantity = quantity - $2
 *    WHERE variant_id = $1 AND quantity - reserved_quantity >= $2
 *
 * Because the check and the write happen in one statement, two attempts at the
 * last unit cannot both succeed. This test drives the repository directly
 * (rather than through checkout) so the guard itself is what is under test: the
 * first call removes the unit, the second returns false and changes nothing.
 */
import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedDb } from './helpers/database.js';
import {
  deduct,
  lockInventory,
  recordTransaction,
} from '../src/repositories/inventory.repository.js';

let pg; // the PGlite instance (owns close)
let db; // the executor the repository accepts
let categoryId;

before(async () => {
  pg = await createMigratedDb();
  db = { query: (text, params = []) => pg.query(text, params) };

  const { rows } = await pg.query(
    `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat') RETURNING id`
  );
  categoryId = rows[0].id;
});

after(async () => {
  await pg?.close();
});

let skuSeq = 0;

/**
 * Creates a product + variant, with an inventory row unless `stock` is null
 * (which models an untracked digital product).
 * @returns {Promise<string>} the variant id
 */
async function makeVariant({ stock = 0, reserved = 0 } = {}) {
  skuSeq += 1;

  const { rows: product } = await pg.query(
    `INSERT INTO products (category_id, name, slug, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [categoryId, `Widget ${skuSeq}`, `widget-${skuSeq}`]
  );

  const { rows: variant } = await pg.query(
    `INSERT INTO product_variants (product_id, sku, price)
     VALUES ($1, $2, 1000) RETURNING id`,
    [product[0].id, `SKU-${skuSeq}`]
  );

  if (stock !== null) {
    await pg.query(
      `INSERT INTO inventory (variant_id, quantity, reserved_quantity)
       VALUES ($1, $2, $3)`,
      [variant[0].id, stock, reserved]
    );
  }

  return variant[0].id;
}

test('the last unit can only be sold once', async () => {
  const variantId = await makeVariant({ stock: 1 });

  assert.equal(await deduct(db, variantId, 1), true, 'the first checkout takes it');
  assert.equal(await deduct(db, variantId, 1), false, 'the second finds nothing');

  const { rows } = await pg.query(`SELECT quantity FROM inventory WHERE variant_id = $1`, [
    variantId,
  ]);
  assert.equal(rows[0].quantity, 0, 'stock never goes negative');
});

test('reserved units are not available to a sale', async () => {
  const variantId = await makeVariant({ stock: 5, reserved: 4 });

  assert.equal(await deduct(db, variantId, 2), false, 'only 1 unit is actually free');
  assert.equal(await deduct(db, variantId, 1), true, 'the free unit can still be taken');

  const { rows } = await pg.query(
    `SELECT quantity, reserved_quantity FROM inventory WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[0].reserved_quantity, 4);
});

test('an untracked variant has no inventory row and cannot be deducted', async () => {
  const variantId = await makeVariant({ stock: null });

  assert.equal(await lockInventory(db, variantId), null);
  assert.equal(await deduct(db, variantId, 1), false, 'no row means nothing to deduct');
});

test('lockInventory returns the tracked row (for a FOR UPDATE lock)', async () => {
  const variantId = await makeVariant({ stock: 7, reserved: 2 });

  const locked = await lockInventory(db, variantId);
  assert.equal(locked.quantity, 7);
  assert.equal(locked.reserved_quantity, 2);
});

test('recordTransaction appends a signed movement to the ledger', async () => {
  const variantId = await makeVariant({ stock: 10 });

  const ledgerRow = await recordTransaction(db, {
    variantId,
    type: 'SALE',
    quantity: -3,
    referenceType: 'MANUAL',
    note: 'test movement',
  });
  assert.ok(ledgerRow?.id, 'a ledger row is returned');

  const { rows } = await pg.query(
    `SELECT transaction_type, quantity FROM inventory_transactions WHERE variant_id = $1`,
    [variantId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transaction_type, 'SALE');
  assert.equal(rows[0].quantity, -3);

  // The schema refuses a movement whose sign disagrees with its type.
  await assert.rejects(
    () => recordTransaction(db, { variantId, type: 'SALE', quantity: 1 }),
    /inventory_transactions|check|sign/i
  );
});
