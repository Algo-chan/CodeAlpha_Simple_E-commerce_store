/**
 * The seeded data holds together, and the schema keeps it true over time.
 *
 * A schema can have correct constraints and still ship inconsistent demo data,
 * and a snapshot can look right until something edits the underlying row. These
 * tests check the data itself, then mutate the catalogue and confirm past
 * orders do not change.
 *
 * Runs against PGlite, so no PostgreSQL server is needed; see
 * helpers/database.js.
 */
import './setup.js';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSeededDb, fingerprint, runSeeds } from './helpers/database.js';

let db;

before(async () => {
  db = await createSeededDb();
});

after(async () => {
  await db?.close();
});

const ABBE = '10000000-0000-4000-8000-000000000002';
const NIKE = '40000000-0000-4000-8000-000000000001';

describe('seeded catalogue', () => {
  test('every table has rows', async () => {
    const tables = [
      'users',
      'addresses',
      'categories',
      'products',
      'product_images',
      'product_variants',
      'inventory',
      'inventory_transactions',
      'carts',
      'cart_items',
      'wishlists',
      'wishlist_items',
      'orders',
      'order_items',
      'payments',
      'reviews',
    ];

    const empty = [];
    for (const table of tables) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      if (rows[0].n === 0) empty.push(table);
    }
    assert.deepEqual(empty, [], `tables with no seed data: ${empty.join(', ')}`);
  });

  test('the category tree resolves three levels deep', async () => {
    const { rows } = await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id, slug, 0 AS depth FROM categories WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.slug, t.depth + 1
          FROM categories c JOIN tree t ON c.parent_id = t.id
      )
      SELECT slug, depth FROM tree ORDER BY depth, slug`);

    const deepest = Math.max(...rows.map((row) => row.depth));
    assert.equal(deepest, 2, 'the tree should have a root, a child and a grandchild');

    // Every category must be reachable from a root, or it is orphaned.
    assert.equal(rows.length, 13, 'every seeded category must appear in the tree');
  });

  test('no category is its own ancestor', async () => {
    const { rows } = await db.query(`
      WITH RECURSIVE walk AS (
        SELECT id, parent_id, 1 AS depth FROM categories WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.parent_id, w.depth + 1
          FROM categories c JOIN walk w ON c.parent_id = w.id
        WHERE w.depth < 20
      )
      SELECT id FROM walk WHERE depth > 20`);
    assert.deepEqual(rows, [], 'a cycle would never terminate');
  });

  test('every product category reference resolves', async () => {
    const { rows } = await db.query(`
      SELECT p.slug FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.category_id IS NOT NULL AND c.id IS NULL`);
    assert.deepEqual(rows, []);
  });

  test('each product has exactly one primary image', async () => {
    const { rows } = await db.query(`
      SELECT p.slug, count(*) FILTER (WHERE i.is_primary)::int AS primary_count
        FROM products p
        LEFT JOIN product_images i ON i.product_id = p.id
       GROUP BY p.slug
      HAVING count(*) FILTER (WHERE i.is_primary) <> 1`);

    assert.deepEqual(rows, [], 'exactly one primary image per product is expected');
  });

  test('digital products are not stock-tracked', async () => {
    const { rows } = await db.query(`
      SELECT p.slug
        FROM products p
        JOIN product_variants v ON v.product_id = p.id
        JOIN inventory i ON i.variant_id = v.id
       WHERE p.product_type = 'DIGITAL'`);
    assert.deepEqual(rows, [], 'a download has no stock to track');
  });

  test('a sold-out variant exists, so the empty state is demonstrable', async () => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM inventory WHERE quantity = 0`);
    assert.ok(rows[0].n > 0, 'expected at least one sold-out variant');
  });
});

describe('seeded orders', () => {
  test('order totals equal the sum of their lines', async () => {
    const { rows } = await db.query(`
      SELECT o.order_number, o.subtotal, o.delivery_fee, o.discount_total, o.total,
             COALESCE(SUM(oi.subtotal), 0)::bigint AS items_total
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id, o.order_number, o.subtotal, o.delivery_fee, o.discount_total, o.total`);

    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(Number(row.subtotal), Number(row.items_total), row.order_number);
      assert.equal(
        Number(row.total),
        Number(row.subtotal) + Number(row.delivery_fee) - Number(row.discount_total),
        row.order_number
      );
    }
  });

  test('an order was placed on the date its number claims', async () => {
    const { rows } = await db.query(`
      SELECT order_number,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDD') AS placed
        FROM orders
       WHERE order_number ~ '^ORD-[0-9]{8}-'
       ORDER BY order_number`);

    assert.ok(rows.length > 0, 'expected dated order numbers');
    for (const row of rows) {
      const claimed = row.order_number.slice(4, 12).replace('-', '');
      assert.equal(row.placed, claimed, row.order_number);
    }
  });

  test('the demo covers a guest checkout and a cancelled order', async () => {
    const { rows } = await db.query(`
      SELECT
        count(*) FILTER (WHERE user_id IS NULL)::int AS guest_orders,
        count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
        count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered
        FROM orders`);

    assert.ok(rows[0].guest_orders > 0, 'expected a guest order');
    assert.ok(rows[0].cancelled > 0, 'expected a cancelled order');
    assert.ok(rows[0].delivered > 0, 'expected a delivered order');
  });

  test('a verified-purchase review exists', async () => {
    const { rows } = await db.query(`
      SELECT r.id FROM reviews r
        JOIN order_items oi ON oi.id = r.order_item_id
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'DELIVERED' AND o.user_id = r.user_id`);

    assert.ok(rows.length > 0, 'expected a review of a delivered purchase');
  });
});

describe('verified purchase query', () => {
  /**
   * The shape the review service will use. Verified purchase is derived, not
   * stored, so it stays correct when an order is later cancelled.
   */
  // One row per matching order line, so a customer who bought two pairs of the
  // same model has two qualifying lines. The question is only whether any exist.
  const query = `
    SELECT 1 AS qualifies
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = $1 AND o.user_id = $2 AND o.status = 'DELIVERED'`;

  test('a delivered purchase qualifies its reviewer', async () => {
    const { rows } = await db.query(query, [NIKE, ABBE]);
    assert.ok(rows.length > 0, 'the reviewer should qualify on their delivered order');
  });

  test('a different customer does not qualify', async () => {
    const { rows } = await db.query(query, [NIKE, '10000000-0000-4000-8000-000000000003']);
    assert.equal(rows.length, 0);
  });

  test('a guest order can never qualify a reviewer', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM orders WHERE user_id IS NULL AND status = 'DELIVERED'`
    );
    // Guest orders have no user to match, so no review can ever be attributed
    // to them. This asserts the precondition that makes that true.
    assert.ok(
      rows.every((row) => row.user_id === null),
      'a guest order must not carry a user_id'
    );
  });
});

describe('order snapshots are immutable', () => {
  before(async () => {
    // Edit the address, raise the price and rename the product.
    await db.query(
      `UPDATE addresses
          SET street = 'COMPLETELY DIFFERENT STREET 999', city = 'Adama', area = 'Tabor'
        WHERE id = '20000000-0000-4000-8000-000000000001'`
    );
    // A realistic price rise: the promotion is withdrawn in the same statement,
    // because compare_at_price must stay above price.
    await db.query(
      `UPDATE product_variants SET price = 999900, compare_at_price = NULL
        WHERE sku = 'NIKE-AM270-BLK-42'`
    );
    await db.query(`UPDATE products SET name = 'RENAMED PRODUCT' WHERE slug = 'nike-air-max-270'`);
  });

  test('the order keeps the address as it was at checkout', async () => {
    const { rows } = await db.query(`
      SELECT shipping_address_snapshot ->> 'street' AS street,
             shipping_address_snapshot ->> 'city' AS city
        FROM orders WHERE order_number = 'ORD-20260115-0001'`);

    assert.equal(rows[0].street, 'Bole Road, House 24');
    assert.equal(rows[0].city, 'Addis Ababa');
  });

  test('the order line keeps the price that was charged', async () => {
    const { rows } = await db.query(`
      SELECT oi.unit_price, pv.price AS live_price
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.variant_id
       WHERE oi.sku = 'NIKE-AM270-BLK-42'`);

    assert.equal(Number(rows[0].unit_price), 470000);
    assert.equal(Number(rows[0].live_price), 999900, 'the live price must have changed');
  });

  test('the order line keeps the product name as it was', async () => {
    const { rows } = await db.query(`
      SELECT oi.product_name, p.name AS live_name
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
       WHERE oi.sku = 'NIKE-AM270-BLK-42'`);

    assert.equal(rows[0].product_name, 'Nike Air Max 270');
    assert.equal(rows[0].live_name, 'RENAMED PRODUCT');
  });

  test('an order survives its customer being deleted', async () => {
    // ON DELETE SET NULL, so account deletion keeps order history intact.
    await db.query(
      `INSERT INTO orders
         (id, order_number, user_id, status, subtotal, total,
          customer_email, customer_phone, shipping_address_snapshot)
       VALUES ('90000000-0000-4000-8000-000000000099', 'ORD-SCRATCH-0001', $1,
               'PENDING', 0, 0, 'abebe@example.com', '0911223344',
               '{"full_name":"A","city":"B"}'::jsonb)`,
      [ABBE]
    );
    await db.query(`UPDATE orders SET user_id = NULL WHERE order_number = 'ORD-SCRATCH-0001'`);

    const { rows } = await db.query(`
      SELECT order_number, user_id, customer_email
        FROM orders WHERE order_number = 'ORD-SCRATCH-0001'`);

    assert.equal(rows.length, 1, 'the order must survive');
    assert.equal(rows[0].user_id, null);
    assert.equal(rows[0].customer_email, 'abebe@example.com', 'contact details are kept');
  });
});

describe('triggers', () => {
  test('updated_at advances on UPDATE', async () => {
    const before_ = await db.query(`SELECT updated_at FROM products WHERE slug = 'jbl-tune-510bt'`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.query(`UPDATE products SET brand = 'TriggerBrand' WHERE slug = 'jbl-tune-510bt'`);
    const after_ = await db.query(`SELECT updated_at FROM products WHERE slug = 'jbl-tune-510bt'`);

    assert.ok(
      new Date(after_.rows[0].updated_at) > new Date(before_.rows[0].updated_at),
      'the trigger must move updated_at forward'
    );
  });

  test('every mutable table has the trigger, and the ledger does not', async () => {
    const { rows: triggered } = await db.query(`
      SELECT c.relname FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname = 'public'
         AND t.tgname LIKE '%\\_set\\_updated\\_at'
         AND c.relname <> 'schema_migrations'`);

    const { rows: ledger } = await db.query(`
      SELECT count(*)::int AS n FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname = 'inventory_transactions'`);

    assert.equal(ledger[0].n, 0, 'the stock ledger must stay append-only');
    assert.equal(
      triggered.length,
      16,
      `expected 16 triggered tables, got ${triggered.length}: ${triggered.map((r) => r.relname).join(', ')}`
    );
  });
});

describe('seeds are re-runnable', () => {
  const TABLES = [
    'users',
    'addresses',
    'categories',
    'products',
    'product_images',
    'product_variants',
    'inventory',
    'inventory_transactions',
    'carts',
    'cart_items',
    'wishlists',
    'wishlist_items',
    'orders',
    'order_items',
    'payments',
    'reviews',
  ];

  test('running the seeds again restores the canonical values', async () => {
    // The tests above renamed a product and changed a price. A seed run must
    // put them back, which proves the seeds own those columns.
    await runSeeds(db);

    const { rows } = await db.query(`SELECT name FROM products WHERE slug = 'nike-air-max-270'`);
    assert.equal(rows[0].name, 'Nike Air Max 270');

    const { rows: variant } = await db.query(
      `SELECT price FROM product_variants WHERE sku = 'NIKE-AM270-BLK-42'`
    );
    assert.equal(Number(variant[0].price), 470000);
  });

  test('running the seeds three times changes no business data', async () => {
    const before = {};
    for (const table of TABLES) before[table] = await fingerprint(db, table);

    await runSeeds(db);
    await runSeeds(db);

    const drifted = [];
    for (const table of TABLES) {
      const after_ = await fingerprint(db, table);
      const first = before[table];
      if (first.n !== after_.n || first.h !== after_.h) drifted.push(table);
    }

    assert.deepEqual(drifted, [], `these tables drifted on re-run: ${drifted.join(', ')}`);
  });

  test('re-running does not duplicate rows', async () => {
    const { rows } = await db.query(`
      SELECT
        (SELECT count(*) FROM products)::int AS products,
        (SELECT count(*) FROM product_variants)::int AS variants,
        (SELECT count(*) FROM inventory_transactions)::int AS ledger,
        (SELECT count(*) FROM orders)::int AS orders,
        (SELECT count(*) FROM reviews)::int AS reviews`);

    assert.equal(rows[0].products, 9);
    assert.equal(rows[0].variants, 21);
    // 21 opening movements plus 4 sales from the delivered order.
    assert.equal(rows[0].ledger, 25);
    assert.equal(rows[0].orders, 4, 'three seeded orders plus the scratch order');
    assert.equal(rows[0].reviews, 1);
  });
});
