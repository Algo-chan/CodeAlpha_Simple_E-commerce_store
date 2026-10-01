/**
 * The schema enforces its own rules.
 *
 * Every constraint is tested by trying to break it. A `CHECK` that silently
 * accepts bad data is worse than a missing one, because application code will
 * trust it. These tests run against PGlite, so they need no PostgreSQL server;
 * see helpers/database.js.
 */
import './setup.js';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSeededDb, expectRejected } from './helpers/database.js';

let db;

before(async () => {
  db = await createSeededDb();
});

after(async () => {
  await db?.close();
});

const ABBE = '10000000-0000-4000-8000-000000000002';
const SARA = '10000000-0000-4000-8000-000000000003';
const NIKE = '40000000-0000-4000-8000-000000000001';
const MACBOOK = '40000000-0000-4000-8000-000000000003';
const EBOOK = '40000000-0000-4000-8000-000000000007';
const VARIANT = '50000000-0000-4000-8000-000000000001';
const VARIANT_IN_CART = '50000000-0000-4000-8000-000000000002';
const VARIANT_UNORDERED = '50000000-0000-4000-8000-000000000004';
const ABBE_CART = '80000000-0000-4000-8000-000000000001';
const ABBE_WISHLIST = '81000000-0000-4000-8000-000000000001';
const DELIVERED_ORDER = '90000000-0000-4000-8000-000000000001';
const PENDING_ORDER = '90000000-0000-4000-8000-000000000002';
const DELIVERED_LINE = '91000000-0000-4000-8000-000000000001';

/** A well-formed but unusable hash: matches the bcrypt shape, never a real one. */
const FAKE_HASH = '$2b$12$0000000000000000000000000000000000000000000000000000';

/** The minimum shipping snapshot an order can carry. */
const SNAPSHOT = `'{"full_name":"A","city":"B"}'::jsonb`;

describe('users', () => {
  test('rejects a plain-text password', async () => {
    await expectRejected(
      db,
      `INSERT INTO users (name, email, password_hash) VALUES ('X', 'x@example.com', 'hunter2')`,
      [],
      /password_hash/
    );
  });

  test('rejects an uppercase email', async () => {
    await expectRejected(
      db,
      `INSERT INTO users (name, email, password_hash) VALUES ('X', 'X@Example.com', $1)`,
      [FAKE_HASH],
      /email/
    );
  });

  test('rejects a duplicate email', async () => {
    await expectRejected(
      db,
      `INSERT INTO users (name, email, password_hash) VALUES ('X', 'abebe@example.com', $1)`,
      [FAKE_HASH],
      /users_email_key|unique/i
    );
  });

  test('rejects an unknown role', async () => {
    await expectRejected(
      db,
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('X', 'y@example.com', $1, 'SUPERUSER')`,
      [FAKE_HASH],
      /role/
    );
  });
});

describe('addresses', () => {
  test('rejects a malformed phone number', async () => {
    await expectRejected(
      db,
      `INSERT INTO addresses (user_id, full_name, phone, city, area, street)
       VALUES ($1, 'A', '123', 'Addis Ababa', 'Bole', 'Somewhere')`,
      [SARA]
    );
  });

  test('rejects a second default address for one user', async () => {
    await expectRejected(
      db,
      `INSERT INTO addresses (user_id, full_name, phone, city, area, street, is_default)
       VALUES ($1, 'A', '0911000000', 'Addis Ababa', 'Bole', 'Elsewhere', TRUE)`,
      [ABBE],
      /one_default|unique/i
    );
  });
});

describe('categories', () => {
  test('rejects a duplicate slug', async () => {
    await expectRejected(db, `INSERT INTO categories (name, slug) VALUES ('Copy', 'electronics')`);
  });

  test('rejects a slug that is not lowercase and hyphenated', async () => {
    await expectRejected(db, `INSERT INTO categories (name, slug) VALUES ('Bad', 'Not A Slug')`);
  });

  test('rejects a category that is its own parent', async () => {
    await expectRejected(db, `UPDATE categories SET parent_id = id WHERE slug = 'phones'`);
  });

  test('rejects deleting a category that still has children', async () => {
    await expectRejected(
      db,
      `DELETE FROM categories WHERE slug = 'electronics'`,
      [],
      /categories_parent_id_fkey/
    );
  });

  test('a category cannot be its own ancestor at any depth', async () => {
    // Phones is a child of Electronics and the parent of Smartphones; making
    // Electronics a descendant of its own child would create a cycle.
    await expectRejected(
      db,
      `UPDATE categories SET parent_id = (
      WITH RECURSIVE t AS (
        SELECT id FROM categories WHERE slug = 'smartphones'
        UNION ALL
        SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id
      ) SELECT id FROM t LIMIT 1
    ) WHERE slug = 'electronics'`
    );
  });
});

describe('products and variants', () => {
  test('rejects a duplicate product slug', async () => {
    await expectRejected(
      db,
      `INSERT INTO products (name, slug, product_type) VALUES ('Copy', 'nike-air-max-270', 'PHYSICAL')`
    );
  });

  test('rejects a duplicate SKU', async () => {
    await expectRejected(
      db,
      `INSERT INTO product_variants (product_id, sku, price) VALUES ($1, 'NIKE-AM270-BLK-40', 1000)`,
      [NIKE]
    );
  });

  test('rejects a negative price', async () => {
    await expectRejected(
      db,
      `INSERT INTO product_variants (product_id, sku, price) VALUES ($1, 'NEW-1', -1)`,
      [NIKE]
    );
  });

  test('rejects a compare_at_price below the price', async () => {
    await expectRejected(
      db,
      `INSERT INTO product_variants (product_id, sku, price, compare_at_price)
       VALUES ($1, 'NEW-2', 5000, 1000)`,
      [NIKE]
    );
  });

  test('rejects attributes that are not a JSON object', async () => {
    await expectRejected(
      db,
      `INSERT INTO product_variants (product_id, sku, price, attributes)
       VALUES ($1, 'NEW-3', 5000, '"red"'::jsonb)`,
      [NIKE]
    );
  });

  test('rejects a second primary image for the same product', async () => {
    await expectRejected(
      db,
      `INSERT INTO product_images (product_id, image_url, is_primary)
       VALUES ($1, 'https://example.com/x.png', TRUE)`,
      [NIKE],
      /primary|unique/i
    );
  });

  test('rejects hard-deleting a product that has been ordered', async () => {
    // Order history keeps the product alive, so it cannot be deleted out from
    // under the orders that reference it.
    await expectRejected(
      db,
      `DELETE FROM products WHERE slug = 'jbl-tune-510bt'`,
      [],
      /order_items_product_id_fkey/
    );
  });

  test('rejects hard-deleting a variant that has stock movements or orders', async () => {
    // Either the ledger or the order lines would be orphaned.
    await expectRejected(
      db,
      `DELETE FROM product_variants WHERE sku = 'JBL-510BT-BLK'`,
      [],
      /variant_id_fkey/
    );
  });
});

describe('inventory', () => {
  test('rejects a negative quantity', async () => {
    await expectRejected(db, `UPDATE inventory SET quantity = -1 WHERE variant_id = $1`, [VARIANT]);
  });

  test('rejects reserving more than is in stock', async () => {
    await expectRejected(
      db,
      `UPDATE inventory SET reserved_quantity = quantity + 1 WHERE variant_id = $1`,
      [VARIANT]
    );
  });

  test('rejects a zero-quantity ledger entry', async () => {
    await expectRejected(
      db,
      `INSERT INTO inventory_transactions (variant_id, transaction_type, quantity)
       VALUES ($1, 'RESTOCK', 0)`,
      [VARIANT]
    );
  });

  test('rejects a positive SALE, because the sign must match the type', async () => {
    await expectRejected(
      db,
      `INSERT INTO inventory_transactions (variant_id, transaction_type, quantity, reference_type)
       VALUES ($1, 'SALE', 5, 'MANUAL')`,
      [VARIANT]
    );
  });

  test('rejects a reference_id with no reference_type', async () => {
    await expectRejected(
      db,
      `INSERT INTO inventory_transactions (variant_id, transaction_type, quantity, reference_id)
       VALUES ($1, 'RESTOCK', 5, $2)`,
      [VARIANT, DELIVERED_ORDER]
    );
  });

  test('the ledger sum equals the recorded balance for every variant', async () => {
    const { rows } = await db.query(`
      SELECT v.sku, i.quantity, COALESCE(SUM(t.quantity), 0)::int AS ledger_total
        FROM inventory i
        JOIN product_variants v ON v.id = i.variant_id
        LEFT JOIN inventory_transactions t ON t.variant_id = i.variant_id
       GROUP BY v.sku, i.quantity`);

    assert.ok(rows.length > 0, 'expected tracked inventory');
    const unbalanced = rows.filter((row) => row.ledger_total !== row.quantity);
    assert.deepEqual(unbalanced, [], 'ledger must explain the balance exactly');
  });

  test('no variant is over-reserved', async () => {
    const { rows } = await db.query(`
      SELECT v.sku FROM inventory i
        JOIN product_variants v ON v.id = i.variant_id
       WHERE i.reserved_quantity > i.quantity`);
    assert.deepEqual(rows, []);
  });

  test('digital products have no inventory rows', async () => {
    const { rows } = await db.query(`
      SELECT p.slug
        FROM products p
        JOIN product_variants pv ON pv.product_id = p.id
        JOIN inventory i ON i.variant_id = pv.id
       WHERE p.product_type = 'DIGITAL'`);
    assert.deepEqual(rows, [], 'a digital download must not be stock-tracked');
  });
});

describe('carts', () => {
  test('rejects a cart owned by both a user and a session', async () => {
    await expectRejected(db, `INSERT INTO carts (user_id, session_token) VALUES ($1, $2)`, [
      ABBE,
      'a'.repeat(40),
    ]);
  });

  test('rejects a cart owned by neither', async () => {
    await expectRejected(db, `INSERT INTO carts (user_id) VALUES (NULL)`);
  });

  test('rejects a guest session token shorter than 32 characters', async () => {
    await expectRejected(db, `INSERT INTO carts (session_token) VALUES ('tooshort')`);
  });

  test('rejects a second ACTIVE cart for the same user', async () => {
    await expectRejected(db, `INSERT INTO carts (user_id) VALUES ($1)`, [ABBE]);
  });

  test('rejects a cart that merges into itself', async () => {
    await expectRejected(db, `UPDATE carts SET merged_into_cart_id = id WHERE id = $1`, [
      ABBE_CART,
    ]);
  });

  test('rejects the same variant twice in one cart', async () => {
    await expectRejected(
      db,
      `INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1, $2, 1)`,
      [ABBE_CART, VARIANT_IN_CART]
    );
  });

  test('rejects a zero-quantity cart line', async () => {
    await expectRejected(
      db,
      `INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1, $2, 0)`,
      [ABBE_CART, VARIANT_UNORDERED]
    );
  });

  test('stores no price on cart lines', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'cart_items' AND (column_name LIKE '%price%' OR column_name LIKE '%total%')`
    );
    assert.deepEqual(rows, [], 'totals must be computed, never cached on the line');
  });
});

describe('wishlists', () => {
  test('rejects a duplicate entry for the same product', async () => {
    await expectRejected(
      db,
      `INSERT INTO wishlist_items (wishlist_id, product_id) VALUES ($1, $2)`,
      [ABBE_WISHLIST, NIKE]
    );
  });

  test('rejects a second wishlist for one user', async () => {
    await expectRejected(db, `INSERT INTO wishlists (user_id) VALUES ($1)`, [ABBE]);
  });
});

describe('orders', () => {
  test('rejects a duplicate order number', async () => {
    await expectRejected(
      db,
      `INSERT INTO orders (order_number, subtotal, total, customer_email, customer_phone, shipping_address_snapshot)
       VALUES ('ORD-20260115-0001', 0, 0, 'a@example.com', '0911000000', ${SNAPSHOT})`,
      [],
      /order_number.*unique|unique.*order_number/i
    );
  });

  test('rejects a total that disagrees with subtotal + fee - discount', async () => {
    await expectRejected(
      db,
      `INSERT INTO orders (order_number, subtotal, delivery_fee, discount_total, total,
                           customer_email, customer_phone, shipping_address_snapshot)
       VALUES ('ORD-TEST-BAD', 1000, 100, 0, 5000, 'a@example.com', '0911000000', ${SNAPSHOT})`
    );
  });

  test('rejects a discount larger than the subtotal', async () => {
    await expectRejected(
      db,
      `INSERT INTO orders (order_number, subtotal, delivery_fee, discount_total, total,
                           customer_email, customer_phone, shipping_address_snapshot)
       VALUES ('ORD-TEST-BAD2', 1000, 0, 2000, 0, 'a@example.com', '0911000000', ${SNAPSHOT})`
    );
  });

  test('rejects a status outside the lifecycle', async () => {
    await expectRejected(
      db,
      `INSERT INTO orders (order_number, subtotal, total, status,
                           customer_email, customer_phone, shipping_address_snapshot)
       VALUES ('ORD-TEST-BAD3', 0, 0, 'RETURNED', 'a@example.com', '0911000000', ${SNAPSHOT})`
    );
  });

  test('rejects a shipping snapshot with no recipient name', async () => {
    await expectRejected(
      db,
      `INSERT INTO orders (order_number, subtotal, total,
                           customer_email, customer_phone, shipping_address_snapshot)
       VALUES ('ORD-TEST-BAD4', 0, 0, 'a@example.com', '0911000000', '{"city":"B"}'::jsonb)`
    );
  });

  test('rejects hard-deleting an order that has payments', async () => {
    await expectRejected(
      db,
      `DELETE FROM orders WHERE order_number = 'ORD-20260115-0001'`,
      [],
      /payments_order_id_fkey/
    );
  });

  test('order totals equal the sum of their lines', async () => {
    const { rows } = await db.query(`
      SELECT o.order_number, o.subtotal, o.delivery_fee, o.discount_total, o.total,
             COALESCE(SUM(oi.subtotal), 0)::bigint AS items_total,
             COALESCE(SUM(oi.unit_price * oi.quantity), 0)::bigint AS recomputed
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id, o.order_number, o.subtotal, o.delivery_fee, o.discount_total, o.total`);

    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(Number(row.subtotal), Number(row.items_total), row.order_number);
      assert.equal(Number(row.items_total), Number(row.recomputed), row.order_number);
      assert.equal(
        Number(row.total),
        Number(row.subtotal) + Number(row.delivery_fee) - Number(row.discount_total),
        row.order_number
      );
    }
  });

  test('order_item.sku matches the variant it references', async () => {
    const { rows } = await db.query(`
      SELECT oi.id FROM order_items oi
       WHERE oi.variant_id IS NOT NULL
         AND oi.sku IS DISTINCT FROM (
           SELECT pv.sku FROM product_variants pv WHERE pv.id = oi.variant_id)`);
    assert.deepEqual(rows, []);
  });
});

describe('order_items', () => {
  test('rejects a subtotal that is not unit_price x quantity', async () => {
    await expectRejected(
      db,
      `INSERT INTO order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, subtotal)
       VALUES ($1, $2, $3, 'X', 100, 2, 999)`,
      [DELIVERED_ORDER, NIKE, VARIANT]
    );
  });

  test('rejects a zero-quantity line', async () => {
    await expectRejected(
      db,
      `INSERT INTO order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, subtotal)
       VALUES ($1, $2, $3, 'X', 100, 0, 0)`,
      [DELIVERED_ORDER, NIKE, VARIANT]
    );
  });

  test('rejects an empty product name snapshot', async () => {
    await expectRejected(
      db,
      `INSERT INTO order_items (order_id, product_id, variant_id, product_name, unit_price, quantity, subtotal)
       VALUES ($1, $2, $3, '   ', 100, 1, 100)`,
      [DELIVERED_ORDER, NIKE, VARIANT]
    );
  });
});

describe('payments', () => {
  test('rejects recording the same provider transaction twice', async () => {
    await expectRejected(
      db,
      `INSERT INTO payments (order_id, method, status, amount, transaction_reference, paid_at)
       VALUES ($1, 'ONLINE', 'PAID', 100, 'pi_demo_failed_attempt_0001', NOW())`,
      [PENDING_ORDER],
      /transaction_reference|unique/i
    );
  });

  test('rejects PAID without paid_at', async () => {
    await expectRejected(
      db,
      `INSERT INTO payments (order_id, method, status, amount) VALUES ($1, 'COD', 'PAID', 100)`,
      [PENDING_ORDER]
    );
  });

  test('rejects FAILED without a reason', async () => {
    await expectRejected(
      db,
      `INSERT INTO payments (order_id, method, status, amount) VALUES ($1, 'ONLINE', 'FAILED', 100)`,
      [PENDING_ORDER]
    );
  });

  test('rejects a negative amount', async () => {
    await expectRejected(
      db,
      `INSERT INTO payments (order_id, method, status, amount) VALUES ($1, 'COD', 'PENDING', -5)`,
      [PENDING_ORDER]
    );
  });
});

describe('reviews', () => {
  test('rejects a rating below 1', async () => {
    await expectRejected(
      db,
      `INSERT INTO reviews (user_id, product_id, order_item_id, rating)
       VALUES ($1, $2, '91000000-0000-4000-8000-000000000004', 0)`,
      [SARA, EBOOK]
    );
  });

  test('rejects a rating above 5', async () => {
    await expectRejected(
      db,
      `INSERT INTO reviews (user_id, product_id, order_item_id, rating)
       VALUES ($1, $2, '91000000-0000-4000-8000-000000000004', 6)`,
      [SARA, EBOOK]
    );
  });

  test('rejects a second review of the same product by the same customer', async () => {
    await expectRejected(
      db,
      `INSERT INTO reviews (user_id, product_id, order_item_id, rating)
       VALUES ($1, $2, '91000000-0000-4000-8000-000000000002', 4)`,
      [ABBE, NIKE]
    );
  });

  test('rejects reviewing the same order item twice', async () => {
    await expectRejected(
      db,
      `INSERT INTO reviews (user_id, product_id, order_item_id, rating)
       VALUES ($1, $2, $3, 4)`,
      [SARA, MACBOOK, DELIVERED_LINE]
    );
  });

  test('rejects a review with neither a title nor a comment', async () => {
    await expectRejected(
      db,
      `INSERT INTO reviews (user_id, product_id, order_item_id, rating, title, comment)
       VALUES ($1, $2, '91000000-0000-4000-8000-000000000004', 4, '  ', '   ')`,
      [SARA, EBOOK]
    );
  });

  test('every seeded review is anchored to a purchased line', async () => {
    const { rows } = await db.query(`
      SELECT r.id FROM reviews r
       LEFT JOIN order_items oi ON oi.id = r.order_item_id
       LEFT JOIN orders o ON o.id = oi.order_id
       WHERE oi.id IS NULL OR o.id IS NULL OR o.user_id IS DISTINCT FROM r.user_id`);
    assert.deepEqual(rows, [], "a review must belong to the reviewer's own order");
  });
});
