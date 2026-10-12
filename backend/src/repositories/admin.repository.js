/**
 * Admin repository — every SQL statement the store-management surface runs
 * that is not already owned by another repository.
 *
 * WHY THIS IS ONE FILE AND NOT EIGHT
 *
 * The read repositories that precede it (catalogue, order, review) are shaped
 * by what a SHOPPER needs: active products only, approved reviews only, one
 * customer's own orders. Administration is the opposite view — every status,
 * every customer, a mixture of entities on one dashboard — so the queries are
 * genuinely different statements rather than the storefront ones with a filter
 * relaxed. They live together because they share one concern (the management
 * view of the store) and one caller (the admin services), and an operator
 * reading this file sees the whole administrative surface in one place.
 *
 * THE RULES THAT ARE NOT NEGOTIABLE HERE
 *
 * 1. Every value is a bound parameter. Sort keys and column names come from
 *    frozen whitelists; nothing request-shaped is ever concatenated into SQL.
 *    A sort key such as `?sort=price-asc` is looked up, never interpolated.
 *
 * 2. Writes accept the transaction executor. Stock adjustments and the audit
 *    row that describes them are written through the same `db`, so they commit
 *    or roll back together and an audit trail can never be a lie.
 *
 * 3. Deletion is not offered for entities order history still points at.
 *    Products are archived, categories deactivated, variants deactivated.
 *    `DELETE` here exists only for product images, which nothing references.
 *
 * 4. Listings never N+1. Aggregates (variant counts, stock, spend) ride along
 *    as LATERAL joins or window counts, so a page costs a fixed number of
 *    queries regardless of page size.
 */
import { query as poolQuery } from '../config/db.js';
import { ParamList, escapeLikePattern } from './catalogue.repository.js';

function executor(db) {
  return db.query ?? poolQuery;
}

function rows(result) {
  return result?.rows ?? [];
}

function changed(result) {
  const n = result?.rowCount ?? result?.affectedRows ?? 0;
  return Number(n) > 0;
}

/* -------------------------------------------------------------------------- */
/* Sort whitelists                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Admin product orderings. Each references an alias available in
 * `listAdminProducts`' inner query. `newest` is the default because an operator
 * usually wants what changed last.
 */
export const ADMIN_PRODUCT_SORTS = Object.freeze({
  newest: 't.created_at DESC, t.name ASC, t.id ASC',
  oldest: 't.created_at ASC, t.name ASC, t.id ASC',
  'name-asc': 't.name ASC, t.id ASC',
  'name-desc': 't.name DESC, t.id ASC',
  'price-asc': 't.price_min_minor ASC NULLS LAST, t.name ASC, t.id ASC',
  'price-desc': 't.price_max_minor DESC NULLS LAST, t.name ASC, t.id ASC',
  'stock-asc': 't.total_stock ASC, t.name ASC, t.id ASC',
  'stock-desc': 't.total_stock DESC, t.name ASC, t.id ASC',
});

export const ADMIN_ORDER_SORTS = Object.freeze({
  newest: 'o.created_at DESC, o.id DESC',
  oldest: 'o.created_at ASC, o.id ASC',
  'total-desc': 'o.total DESC, o.created_at DESC',
  'total-asc': 'o.total ASC, o.created_at DESC',
});

export const ADMIN_CUSTOMER_SORTS = Object.freeze({
  newest: 'u.created_at DESC, u.id DESC',
  oldest: 'u.created_at ASC, u.id ASC',
  'name-asc': 'u.name ASC, u.id ASC',
  'name-desc': 'u.name DESC, u.id ASC',
  'spend-desc': 'total_spent DESC, u.name ASC',
});

export const ADMIN_REVIEW_SORTS = Object.freeze({
  newest: 'r.created_at DESC, r.id DESC',
  oldest: 'r.created_at ASC, r.id ASC',
  'rating-asc': 'r.rating ASC, r.created_at DESC',
  'rating-desc': 'r.rating DESC, r.created_at DESC',
});

export const ADMIN_PAYMENT_SORTS = Object.freeze({
  newest: 'pay.created_at DESC, pay.id DESC',
  oldest: 'pay.created_at ASC, pay.id ASC',
  'amount-desc': 'pay.amount DESC, pay.created_at DESC',
  'amount-asc': 'pay.amount ASC, pay.created_at DESC',
});

export const ADMIN_INVENTORY_SORTS = Object.freeze({
  'stock-asc': 'available ASC, p.name ASC, v.id ASC',
  'stock-desc': 'available DESC, p.name ASC, v.id ASC',
  newest: 'i.updated_at DESC, v.id ASC',
  'sku-asc': 'v.sku ASC, v.id ASC',
  'sku-desc': 'v.sku DESC, v.id ASC',
});

export const ADMIN_AUDIT_SORTS = Object.freeze({
  newest: 'a.created_at DESC, a.id DESC',
  oldest: 'a.created_at ASC, a.id ASC',
});

function pickSort(table, key, fallback) {
  return table[key] ?? table[fallback];
}

/* -------------------------------------------------------------------------- */
/* Dynamic SET builder                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Builds a parameterized `SET` list from a validated patch.
 *
 * Only keys present in `map` are ever emitted, and only when the caller
 * actually supplied a value (`undefined` is skipped, so a PATCH that omits a
 * field leaves it untouched). `null` is a real value and is written, which is
 * what lets a caller clear `category_id` or `compare_at_price`.
 *
 * @param {object} fields  validated patch
 * @param {Record<string, { column: string }>} map  allowed fields
 * @returns {{ sets: string[], params: unknown[] }}
 */
export function buildSet(fields, map) {
  const sets = [];
  const params = [];
  for (const [key, def] of Object.entries(map)) {
    const value = fields[key];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${def.column} = $${params.length}`);
  }
  return { sets, params };
}

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A page of products in any status, with the aggregates an admin row shows:
 * variant count, total stock across variants, price span and the primary image.
 *
 * Unlike the storefront listing this is NOT filtered to ACTIVE and does not
 * require a category (a DRAFT product may have none), which is why it is a
 * separate statement.
 *
 * @param {{ search?: string, status?: string, productType?: string,
 *           categoryId?: string }} filters
 * @param {{ limit: number, offset: number, sort?: string }} page
 * @param {{ query?: Function }} [db]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listAdminProducts(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`p.status = ${params.add(filters.status)}`);
  if (filters.productType) clauses.push(`p.product_type = ${params.add(filters.productType)}`);
  if (filters.categoryId) clauses.push(`p.category_id = ${params.add(filters.categoryId)}`);

  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(p.name ILIKE ${pattern} ESCAPE '\\' OR p.brand ILIKE ${pattern} ESCAPE '\\' OR p.slug ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(ADMIN_PRODUCT_SORTS, page.sort, 'newest');

  const sql = `
    SELECT *
      FROM (
        SELECT
          p.id, p.category_id, p.name, p.slug, p.description, p.product_type,
          p.brand, p.status, p.created_at, p.updated_at,
          c.name AS category_name, c.slug AS category_slug,
          agg.variant_count, agg.active_variant_count, agg.total_stock,
          agg.price_min_minor, agg.price_max_minor,
          im.primary_image_url,
          count(*) OVER ()::int AS total_count
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN LATERAL (
          SELECT
            count(*)::int AS variant_count,
            count(*) FILTER (WHERE v.is_active)::int AS active_variant_count,
            COALESCE(sum(GREATEST(COALESCE(i.quantity,0) - COALESCE(i.reserved_quantity,0), 0)), 0)::bigint AS total_stock,
            min(v.price)::bigint AS price_min_minor,
            max(v.price)::bigint AS price_max_minor
          FROM product_variants v
          LEFT JOIN inventory i ON i.variant_id = v.id
          WHERE v.product_id = p.id
        ) agg ON TRUE
        LEFT JOIN LATERAL (
          SELECT pi.image_url AS primary_image_url
            FROM product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.is_primary DESC, pi.sort_order, pi.id
           LIMIT 1
        ) im ON TRUE
        ${where}
      ) t
      ORDER BY ${orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAdminProducts(db, filters);
  return { rows: data, total };
}

/** Counts products matching the same filters, for pages past the end. */
export async function countAdminProducts(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`p.status = ${params.add(filters.status)}`);
  if (filters.productType) clauses.push(`p.product_type = ${params.add(filters.productType)}`);
  if (filters.categoryId) clauses.push(`p.category_id = ${params.add(filters.categoryId)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(p.name ILIKE ${pattern} ESCAPE '\\' OR p.brand ILIKE ${pattern} ESCAPE '\\' OR p.slug ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execute(
    `SELECT count(*)::int AS total FROM products p ${where}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/** Loads one product in any status, alongside its variant and image counts. */
export async function findAdminProductById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       p.id, p.category_id, p.name, p.slug, p.description, p.product_type,
       p.brand, p.status, p.created_at, p.updated_at,
       c.name AS category_name, c.slug AS category_slug
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/** A product by slug, optionally excluding one id (uniqueness check on update). */
export async function findAdminProductBySlug(db, slug, { excludeId = null } = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT id, slug FROM products WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [slug, excludeId]
  );
  return rows(result)[0] ?? null;
}

export async function insertProduct(db, input) {
  const result = await executor(db)(
    `INSERT INTO products (name, slug, description, product_type, brand, category_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.name,
      input.slug,
      input.description ?? null,
      input.productType,
      input.brand ?? null,
      input.categoryId ?? null,
      input.status,
    ]
  );
  return rows(result)[0] ?? null;
}

export async function updateProduct(db, id, fields) {
  const { sets, params } = buildSet(fields, {
    name: { column: 'name' },
    slug: { column: 'slug' },
    description: { column: 'description' },
    productType: { column: 'product_type' },
    brand: { column: 'brand' },
    categoryId: { column: 'category_id' },
    status: { column: 'status' },
  });

  params.push(id);
  const result = await executor(db)(
    `UPDATE products
        SET ${sets.length > 0 ? `${sets.join(', ')}, ` : ''}updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id`,
    params
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

export async function listVariantsByProduct(db, productId) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       v.id, v.product_id, v.sku, v.price, v.compare_at_price, v.attributes,
       v.is_active, v.created_at, v.updated_at,
       i.quantity, i.reserved_quantity, i.reorder_level,
       COALESCE(i.quantity - i.reserved_quantity, NULL) AS available
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE v.product_id = $1
     ORDER BY v.is_active DESC, v.created_at ASC, v.id`,
    [productId]
  );
  return rows(result);
}

export async function findVariantById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       v.id, v.product_id, v.sku, v.price, v.compare_at_price, v.attributes,
       v.is_active, v.created_at, v.updated_at,
       p.name AS product_name, p.slug AS product_slug, p.status AS product_status
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/** A variant by SKU, optionally excluding one id (uniqueness check on update). */
export async function findVariantBySku(db, sku, { excludeId = null } = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT id, sku FROM product_variants WHERE sku = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [sku, excludeId]
  );
  return rows(result)[0] ?? null;
}

export async function insertVariant(db, input) {
  const result = await executor(db)(
    `INSERT INTO product_variants (product_id, sku, price, compare_at_price, attributes, is_active)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      input.productId,
      input.sku,
      input.price,
      input.compareAtPrice ?? null,
      JSON.stringify(input.attributes ?? {}),
      input.isActive ?? true,
    ]
  );
  return rows(result)[0] ?? null;
}

export async function updateVariant(db, id, fields) {
  const params = [];
  const sets = [];
  const push = (column, value, cast = '') => {
    if (value === undefined) return;
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  push('sku', fields.sku);
  push('price', fields.price);
  push('compare_at_price', fields.compareAtPrice);
  // `attributes` arrives as a JS object; the JSONB cast is written here, where
  // the type is known, rather than left for PostgreSQL to infer.
  if (fields.attributes !== undefined)
    push('attributes', JSON.stringify(fields.attributes), '::jsonb');
  push('is_active', fields.isActive);

  params.push(id);
  const result = await executor(db)(
    `UPDATE product_variants
        SET ${sets.length > 0 ? `${sets.join(', ')}, ` : ''}updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id`,
    params
  );
  return rows(result)[0] ?? null;
}

/**
 * Deactivates a variant. There is deliberately no hard delete: order_items
 * references variants with ON DELETE RESTRICT, so a purchased variant can never
 * be removed without destroying order history. Deactivating hides it from the
 * storefront while keeping the record intact.
 */
export async function deactivateVariant(db, id) {
  const result = await executor(db)(
    `UPDATE product_variants
        SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING id`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Product images                                                              */
/* -------------------------------------------------------------------------- */

export async function listImagesByProduct(db, productId) {
  const execute = executor(db);
  const result = await execute(
    `SELECT id, product_id, image_url, alt_text, sort_order, is_primary, created_at, updated_at
       FROM product_images
      WHERE product_id = $1
      ORDER BY is_primary DESC, sort_order, id`,
    [productId]
  );
  return rows(result);
}

export async function findImageById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT id, product_id, image_url, alt_text, sort_order, is_primary
       FROM product_images WHERE id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/** Demotes every other image of a product before one becomes primary. */
export async function clearPrimaryForProduct(db, productId, { exceptId = null } = {}) {
  await executor(db)(
    `UPDATE product_images
        SET is_primary = FALSE, updated_at = NOW()
      WHERE product_id = $1 AND is_primary AND ($2::uuid IS NULL OR id <> $2)`,
    [productId, exceptId]
  );
}

export async function insertImage(db, input) {
  const result = await executor(db)(
    `INSERT INTO product_images (product_id, image_url, alt_text, sort_order, is_primary)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.productId,
      input.imageUrl,
      input.altText ?? null,
      input.sortOrder ?? 0,
      input.isPrimary ?? false,
    ]
  );
  return rows(result)[0] ?? null;
}

export async function updateImage(db, id, fields) {
  const { sets, params } = buildSet(fields, {
    imageUrl: { column: 'image_url' },
    altText: { column: 'alt_text' },
    sortOrder: { column: 'sort_order' },
    isPrimary: { column: 'is_primary' },
  });

  params.push(id);
  const result = await executor(db)(
    `UPDATE product_images
        SET ${sets.length > 0 ? `${sets.join(', ')}, ` : ''}updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id`,
    params
  );
  return rows(result)[0] ?? null;
}

export async function deleteImage(db, id) {
  const result = await executor(db)(`DELETE FROM product_images WHERE id = $1 RETURNING id`, [id]);
  return changed(result);
}

/** Whether a product exists, in any status. Used to guard image/variant writes. */
export async function productExists(db, id) {
  const result = await executor(db)(`SELECT 1 FROM products WHERE id = $1`, [id]);
  return rows(result).length > 0;
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every category, active or not, with direct and inclusive product counts.
 *
 * Administration must see deactivated categories — that is how a category is
 * brought back — so unlike the storefront reader this does not filter on
 * `is_active`.
 */
export async function listAdminCategories(db = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       c.id, c.parent_id, c.name, c.slug, c.description, c.image_url,
       c.is_active, c.sort_order, c.created_at, c.updated_at,
       COUNT(p.id) FILTER (WHERE p.status <> 'ARCHIVED')::int AS direct_product_count,
       COUNT(p.id)::int AS total_product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id
     GROUP BY c.id
     ORDER BY c.sort_order, c.name`
  );
  return rows(result);
}

export async function findAdminCategoryById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT id, parent_id, name, slug, description, image_url, is_active, sort_order,
            created_at, updated_at
       FROM categories WHERE id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

export async function findAdminCategoryBySlug(db, slug, { excludeId = null } = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT id, slug FROM categories WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [slug, excludeId]
  );
  return rows(result)[0] ?? null;
}

export async function insertCategory(db, input) {
  const result = await executor(db)(
    `INSERT INTO categories (name, slug, parent_id, description, image_url, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.name,
      input.slug,
      input.parentId ?? null,
      input.description ?? null,
      input.imageUrl ?? null,
      input.sortOrder ?? 0,
      input.isActive ?? true,
    ]
  );
  return rows(result)[0] ?? null;
}

export async function updateCategory(db, id, fields) {
  const { sets, params } = buildSet(fields, {
    name: { column: 'name' },
    slug: { column: 'slug' },
    parentId: { column: 'parent_id' },
    description: { column: 'description' },
    imageUrl: { column: 'image_url' },
    sortOrder: { column: 'sort_order' },
    isActive: { column: 'is_active' },
  });

  params.push(id);
  const result = await executor(db)(
    `UPDATE categories
        SET ${sets.length > 0 ? `${sets.join(', ')}, ` : ''}updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id`,
    params
  );
  return rows(result)[0] ?? null;
}

/** Category id -> product count, for the archive guard. */
export async function countProductsInCategory(db, id) {
  const result = await executor(db)(
    `SELECT count(*)::int AS total FROM products WHERE category_id = $1`,
    [id]
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/** Direct children of a category. */
export async function countChildCategories(db, id) {
  const result = await executor(db)(
    `SELECT count(*)::int AS total FROM categories WHERE parent_id = $1`,
    [id]
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/**
 * Whether `candidateParentId` is the node itself or one of its descendants.
 * A category may not be re-parented under its own subtree; migration 019 has a
 * trigger that enforces this, but checking here turns a database error into a
 * clear 409 message.
 */
export async function isDescendantOf(db, rootId, candidateParentId) {
  if (!candidateParentId) return false;
  const result = await executor(db)(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM categories WHERE id = $1
       UNION ALL
       SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
     )
     SELECT 1 FROM subtree WHERE id = $2`,
    [rootId, candidateParentId]
  );
  return rows(result).length > 0;
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A page of tracked inventory rows with the product and variant they belong to.
 *
 * `available` (quantity - reserved) is the number that matters to an operator,
 * and `is_low_stock` uses the same expression as the dashboard metric so the
 * list and the tile can never disagree about how many lines are low.
 */
export async function listAdminInventory(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.lowStock) {
    clauses.push(`(i.quantity - i.reserved_quantity) <= i.reorder_level`);
  }
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(`(p.name ILIKE ${pattern} ESCAPE '\\' OR v.sku ILIKE ${pattern} ESCAPE '\\')`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(ADMIN_INVENTORY_SORTS, page.sort, 'stock-asc');

  const sql = `
    SELECT
      i.variant_id, i.quantity, i.reserved_quantity, i.reorder_level,
      (i.quantity - i.reserved_quantity) AS available,
      ((i.quantity - i.reserved_quantity) <= i.reorder_level) AS is_low_stock,
      i.updated_at,
      v.sku, v.price, v.is_active, v.attributes, v.product_id,
      p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
      count(*) OVER ()::int AS total_count
    FROM inventory i
    JOIN product_variants v ON v.id = i.variant_id
    JOIN products p ON p.id = v.product_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAdminInventory(db, filters);
  return { rows: data, total };
}

export async function countAdminInventory(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.lowStock) {
    clauses.push(`(i.quantity - i.reserved_quantity) <= i.reorder_level`);
  }
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(`(p.name ILIKE ${pattern} ESCAPE '\\' OR v.sku ILIKE ${pattern} ESCAPE '\\')`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execute(
    `SELECT count(*)::int AS total
       FROM inventory i
       JOIN product_variants v ON v.id = i.variant_id
       JOIN products p ON p.id = v.product_id
       ${where}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

export async function findInventoryByVariant(db, variantId) {
  const execute = executor(db);
  const result = await execute(
    `SELECT variant_id, quantity, reserved_quantity, reorder_level, created_at, updated_at
       FROM inventory WHERE variant_id = $1`,
    [variantId]
  );
  return rows(result)[0] ?? null;
}

/**
 * One inventory row in the same joined shape the list returns, so an adjustment
 * response and an inventory list row are the same object.
 */
export async function findAdminInventoryItem(db, variantId) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       i.variant_id, i.quantity, i.reserved_quantity, i.reorder_level,
       (i.quantity - i.reserved_quantity) AS available,
       ((i.quantity - i.reserved_quantity) <= i.reorder_level) AS is_low_stock,
       i.updated_at,
       v.sku, v.price, v.is_active, v.attributes, v.product_id,
       p.name AS product_name, p.slug AS product_slug, p.status AS product_status
     FROM inventory i
     JOIN product_variants v ON v.id = i.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE i.variant_id = $1`,
    [variantId]
  );
  return rows(result)[0] ?? null;
}

/**
 * Ensures an inventory row exists for a variant, creating a zeroed one if not.
 *
 * A missing row means "untracked" (a DIGITAL product). When an operator makes
 * the first stock movement against such a variant they are opting it into stock
 * tracking, so the row is created rather than the adjustment refused.
 */
export async function ensureInventoryRow(db, variantId) {
  await executor(db)(
    `INSERT INTO inventory (variant_id) VALUES ($1) ON CONFLICT (variant_id) DO NOTHING`,
    [variantId]
  );
}

/**
 * Applies a signed delta to on-hand stock, atomically.
 *
 * The `quantity + $2 >= 0` guard is the whole point: it makes "is this
 * adjustment legal?" and "apply it" one statement, so two concurrent
 * adjustments cannot both read the same balance and each subtract past zero.
 * A delta that would push stock negative matches zero rows, and the caller
 * rolls the transaction back.
 *
 * @returns {Promise<object|null>} the updated row, or null when it would go negative
 */
export async function applyStockDelta(db, variantId, delta) {
  const result = await executor(db)(
    `UPDATE inventory
        SET quantity = quantity + $2, updated_at = NOW()
      WHERE variant_id = $1 AND quantity + $2 >= 0
      RETURNING variant_id, quantity, reserved_quantity, reorder_level`,
    [variantId, delta]
  );
  return rows(result)[0] ?? null;
}

export async function updateReorderLevel(db, variantId, level) {
  const result = await executor(db)(
    `UPDATE inventory
        SET reorder_level = $2, updated_at = NOW()
      WHERE variant_id = $1
      RETURNING variant_id, quantity, reserved_quantity, reorder_level`,
    [variantId, level]
  );
  return rows(result)[0] ?? null;
}

/**
 * A page of the stock ledger for one variant, with the actor's name attached.
 * Newest first, because an operator reconciles the last thing that happened.
 */
export async function listInventoryLedger(db, variantId, page) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       t.id, t.variant_id, t.transaction_type, t.quantity, t.reference_type,
       t.reference_id, t.note, t.created_by, t.created_at,
       u.name AS created_by_name,
       count(*) OVER ()::int AS total_count
     FROM inventory_transactions t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.variant_id = $1
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $2 OFFSET $3`,
    [variantId, page.limit, page.offset]
  );
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countInventoryLedger(db, variantId);
  return { rows: data, total };
}

export async function countInventoryLedger(db, variantId) {
  const result = await executor(db)(
    `SELECT count(*)::int AS total FROM inventory_transactions WHERE variant_id = $1`,
    [variantId]
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

export async function listAdminOrders(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`o.status = ${params.add(filters.status)}`);
  if (filters.paymentStatus)
    clauses.push(`o.payment_status = ${params.add(filters.paymentStatus)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(o.order_number ILIKE ${pattern} ESCAPE '\\' OR o.customer_email ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(ADMIN_ORDER_SORTS, page.sort, 'newest');

  const sql = `
    SELECT
      o.id, o.order_number, o.user_id, o.status, o.subtotal, o.delivery_fee,
      o.discount_total, o.coupon_code, o.total, o.currency, o.payment_status, o.payment_method,
      o.customer_email, o.customer_phone, o.created_at, o.updated_at,
      u.name AS customer_name,
      pay.method AS latest_payment_method,
      pay.status AS latest_payment_status,
      pay.transaction_reference AS latest_payment_reference,
      count(*) OVER ()::int AS total_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT p2.method, p2.status, p2.transaction_reference
        FROM payments p2
       WHERE p2.order_id = o.id
       ORDER BY p2.created_at DESC, p2.id DESC
       LIMIT 1
    ) pay ON TRUE
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAdminOrders(db, filters);
  return { rows: data, total };
}

export async function countAdminOrders(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`o.status = ${params.add(filters.status)}`);
  if (filters.paymentStatus)
    clauses.push(`o.payment_status = ${params.add(filters.paymentStatus)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(o.order_number ILIKE ${pattern} ESCAPE '\\' OR o.customer_email ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execute(
    `SELECT count(*)::int AS total FROM orders o ${where}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/** Locks an order row for a status change taken inside a transaction. */
export async function lockOrderByNumber(db, orderNumber) {
  const result = await executor(db)(
    `SELECT id, order_number, user_id, status, payment_status, payment_method,
            total, currency, customer_email, created_at, updated_at
       FROM orders
      WHERE order_number = $1
      FOR UPDATE`,
    [orderNumber]
  );
  return rows(result)[0] ?? null;
}

/** Advances order status (and optionally payment status) by number. */
export async function updateOrderStatus(db, orderNumber, status) {
  const result = await executor(db)(
    `UPDATE orders
        SET status = $2, updated_at = NOW()
      WHERE order_number = $1
      RETURNING id, order_number, status, payment_status, updated_at`,
    [orderNumber, status]
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

export async function listAdminCustomers(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`u.status = ${params.add(filters.status)}`);
  if (filters.role) clauses.push(`u.role = ${params.add(filters.role)}`);
  else clauses.push(`u.role = 'CUSTOMER'`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(`(u.name ILIKE ${pattern} ESCAPE '\\' OR u.email ILIKE ${pattern} ESCAPE '\\')`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(ADMIN_CUSTOMER_SORTS, page.sort, 'newest');

  const sql = `
    SELECT
      u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at, u.last_login_at,
      COALESCE(o.order_count, 0)::int AS order_count,
      COALESCE(o.total_spent, 0)::bigint AS total_spent,
      count(*) OVER ()::int AS total_count
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS order_count,
             COALESCE(sum(ord.total) FILTER (WHERE ord.status <> 'CANCELLED'), 0)::bigint AS total_spent
        FROM orders ord
       WHERE ord.user_id = u.id
    ) o ON TRUE
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAdminCustomers(db, filters);
  return { rows: data, total };
}

export async function countAdminCustomers(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`u.status = ${params.add(filters.status)}`);
  if (filters.role) clauses.push(`u.role = ${params.add(filters.role)}`);
  else clauses.push(`u.role = 'CUSTOMER'`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(`(u.name ILIKE ${pattern} ESCAPE '\\' OR u.email ILIKE ${pattern} ESCAPE '\\')`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const result = await execute(
    `SELECT count(*)::int AS total FROM users u ${where}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/** A customer profile with lifetime order figures. Never selects password_hash. */
export async function findAdminCustomerById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at, u.updated_at,
       u.last_login_at, u.password_changed_at,
       COALESCE(o.order_count, 0)::int AS order_count,
       COALESCE(o.total_spent, 0)::bigint AS total_spent,
       COALESCE(o.cancelled_count, 0)::int AS cancelled_count
     FROM users u
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS order_count,
              COALESCE(sum(ord.total) FILTER (WHERE ord.status <> 'CANCELLED'), 0)::bigint AS total_spent,
              count(*) FILTER (WHERE ord.status = 'CANCELLED')::int AS cancelled_count
         FROM orders ord
        WHERE ord.user_id = u.id
     ) o ON TRUE
     WHERE u.id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/** A page of a customer's orders for the admin profile view. */
export async function listOrdersForCustomer(db, userId, page) {
  const execute = executor(db);
  const result = await execute(
    `SELECT order_number, status, payment_status, payment_method, total, currency, created_at
       FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [userId, page.limit, page.offset]
  );
  return rows(result);
}

export async function countOrdersForCustomer(db, userId) {
  const result = await executor(db)(
    `SELECT count(*)::int AS total FROM orders WHERE user_id = $1`,
    [userId]
  );
  return Number(rows(result)[0]?.total ?? 0);
}

export async function updateUserStatus(db, id, status) {
  const result = await executor(db)(
    `UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1
      RETURNING id, name, email, role, status`,
    [id, status]
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export async function listAdminReviews(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`r.status = ${params.add(filters.status)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(p.name ILIKE ${pattern} ESCAPE '\\' OR u.name ILIKE ${pattern} ESCAPE '\\' OR COALESCE(r.title, '') ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(ADMIN_REVIEW_SORTS, page.sort, 'newest');

  const sql = `
    SELECT
      r.id, r.user_id, r.product_id, r.order_item_id, r.rating, r.title, r.comment,
      r.status, r.moderated_by, r.moderated_at, r.moderation_note,
      r.created_at, r.updated_at,
      u.name AS reviewer_name, u.email AS reviewer_email,
      p.name AS product_name, p.slug AS product_slug,
      m.name AS moderator_name,
      count(*) OVER ()::int AS total_count
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN products p ON p.id = r.product_id
    LEFT JOIN users m ON m.id = r.moderated_by
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAdminReviews(db, filters);
  return { rows: data, total };
}

export async function countAdminReviews(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`r.status = ${params.add(filters.status)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(p.name ILIKE ${pattern} ESCAPE '\\' OR u.name ILIKE ${pattern} ESCAPE '\\' OR COALESCE(r.title, '') ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execute(
    `SELECT count(*)::int AS total
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN products p ON p.id = r.product_id
       ${where}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

export async function findAdminReviewById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT r.id, r.user_id, r.product_id, r.rating, r.title, r.comment, r.status,
            r.moderated_by, r.moderated_at, r.moderation_note, r.created_at, r.updated_at,
            u.name AS reviewer_name, u.email AS reviewer_email,
            p.name AS product_name, p.slug AS product_slug
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN products p ON p.id = r.product_id
      WHERE r.id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/** Records a moderation decision. Author content is never part of the update. */
export async function moderateReview(db, id, { status, moderatedBy, note }) {
  const result = await executor(db)(
    `UPDATE reviews
        SET status = $2,
            moderated_by = $3,
            moderated_at = NOW(),
            moderation_note = $4,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, moderated_by, moderated_at, moderation_note`,
    [id, status, moderatedBy ?? null, note ?? null]
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export async function listAdminPayments(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`pay.status = ${params.add(filters.status)}`);
  if (filters.provider) clauses.push(`pay.provider = ${params.add(filters.provider)}`);
  if (filters.method) clauses.push(`pay.method = ${params.add(filters.method)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(o.order_number ILIKE ${pattern} ESCAPE '\\' OR o.customer_email ILIKE ${pattern} ESCAPE '\\' OR COALESCE(pay.transaction_reference, '') ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(ADMIN_PAYMENT_SORTS, page.sort, 'newest');

  const sql = `
    SELECT
      pay.id, pay.order_id, pay.provider, pay.method, pay.status, pay.amount,
      pay.currency, pay.transaction_reference, pay.failure_reason, pay.paid_at,
      pay.created_at, pay.updated_at,
      o.order_number, o.customer_email, o.status AS order_status,
      count(*) OVER ()::int AS total_count
    FROM payments pay
    JOIN orders o ON o.id = pay.order_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAdminPayments(db, filters);
  return { rows: data, total };
}

export async function countAdminPayments(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.status) clauses.push(`pay.status = ${params.add(filters.status)}`);
  if (filters.provider) clauses.push(`pay.provider = ${params.add(filters.provider)}`);
  if (filters.method) clauses.push(`pay.method = ${params.add(filters.method)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(o.order_number ILIKE ${pattern} ESCAPE '\\' OR o.customer_email ILIKE ${pattern} ESCAPE '\\' OR COALESCE(pay.transaction_reference, '') ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execute(
    `SELECT count(*)::int AS total FROM payments pay JOIN orders o ON o.id = pay.order_id ${where}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

/**
 * One payment with its order context. `transaction_reference` is a provider
 * identifier, not a secret; no card data or key is ever stored or selected.
 */
export async function findAdminPaymentById(db, id) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       pay.id, pay.order_id, pay.provider, pay.method, pay.status, pay.amount,
       pay.currency, pay.transaction_reference, pay.failure_reason, pay.paid_at,
       pay.created_at, pay.updated_at,
       o.order_number, o.customer_email, o.customer_phone, o.status AS order_status,
       o.payment_status AS order_payment_status, o.total AS order_total
     FROM payments pay
     JOIN orders o ON o.id = pay.order_id
     WHERE pay.id = $1`,
    [id]
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The dashboard's order figures in one pass.
 *
 * Three different "revenue" ideas live here, and the point of fetching them
 * together is that they are easy to confuse, so they are computed by the same
 * statement from the same table:
 *
 *   gross  - value of every order that has not been cancelled. Money that was
 *            ordered, whether or not it has been collected.
 *   paid   - value of orders marked PAID. Money actually collected.
 *   pending- value of orders still awaiting payment. Money not yet in hand.
 *
 * None of them is an estimate. Each is a filter over `orders.total`.
 */
export async function getOrderMetrics(db = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       count(*)::int AS total_orders,
       count(*) FILTER (WHERE status = 'PENDING')::int AS pending_orders,
       count(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed_orders,
       count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing_orders,
       count(*) FILTER (WHERE status = 'SHIPPED')::int AS shipped_orders,
       count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered_orders,
       count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_orders,
       COALESCE(sum(total) FILTER (WHERE status <> 'CANCELLED'), 0)::bigint AS gross_sales_minor,
       COALESCE(sum(total) FILTER (WHERE payment_status = 'PAID'), 0)::bigint AS paid_revenue_minor,
       COALESCE(sum(total) FILTER (WHERE payment_status = 'PENDING' AND status <> 'CANCELLED'), 0)::bigint AS pending_payment_minor
     FROM orders`
  );
  return rows(result)[0] ?? {};
}

export async function getProductMetrics(db = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       count(*)::int AS total_products,
       count(*) FILTER (WHERE status = 'ACTIVE')::int AS active_products,
       count(*) FILTER (WHERE status = 'DRAFT')::int AS draft_products,
       count(*) FILTER (WHERE status = 'ARCHIVED')::int AS archived_products
     FROM products`
  );
  return rows(result)[0] ?? {};
}

/**
 * Low-stock count. Uses the SAME expression as the inventory list filter
 * (`available <= reorder_level`), so the tile and the filtered list always
 * agree. A variant with a zero reorder level that has run out is included,
 * which is the common case an operator cares about.
 */
export async function getLowStockCount(db = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT count(*)::int AS low_stock
       FROM inventory i
      WHERE (i.quantity - i.reserved_quantity) <= i.reorder_level`
  );
  return Number(rows(result)[0]?.low_stock ?? 0);
}

export async function getCustomerMetrics(db = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT
       count(*)::int AS total_customers,
       count(*) FILTER (WHERE status = 'ACTIVE')::int AS active_customers,
       count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended_customers
     FROM users
     WHERE role = 'CUSTOMER'`
  );
  return rows(result)[0] ?? {};
}

export async function getPendingReviewCount(db = {}) {
  const execute = executor(db);
  const result = await execute(
    `SELECT count(*)::int AS pending_reviews FROM reviews WHERE status = 'PENDING'`
  );
  return Number(rows(result)[0]?.pending_reviews ?? 0);
}

export async function listRecentOrders(db, limit = 5) {
  const execute = executor(db);
  const result = await execute(
    `SELECT order_number, status, payment_status, total, currency, customer_email, created_at
       FROM orders
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limit]
  );
  return rows(result);
}

export default {
  // products
  listAdminProducts,
  countAdminProducts,
  findAdminProductById,
  findAdminProductBySlug,
  insertProduct,
  updateProduct,
  productExists,
  // variants
  listVariantsByProduct,
  findVariantById,
  findVariantBySku,
  insertVariant,
  updateVariant,
  deactivateVariant,
  // images
  listImagesByProduct,
  findImageById,
  clearPrimaryForProduct,
  insertImage,
  updateImage,
  deleteImage,
  // categories
  listAdminCategories,
  findAdminCategoryById,
  findAdminCategoryBySlug,
  insertCategory,
  updateCategory,
  countProductsInCategory,
  countChildCategories,
  isDescendantOf,
  // inventory
  listAdminInventory,
  countAdminInventory,
  findInventoryByVariant,
  findAdminInventoryItem,
  ensureInventoryRow,
  applyStockDelta,
  updateReorderLevel,
  listInventoryLedger,
  countInventoryLedger,
  // orders
  listAdminOrders,
  countAdminOrders,
  lockOrderByNumber,
  updateOrderStatus,
  // customers
  listAdminCustomers,
  countAdminCustomers,
  findAdminCustomerById,
  listOrdersForCustomer,
  countOrdersForCustomer,
  updateUserStatus,
  // reviews
  listAdminReviews,
  countAdminReviews,
  findAdminReviewById,
  moderateReview,
  // payments
  listAdminPayments,
  countAdminPayments,
  findAdminPaymentById,
  // dashboard
  getOrderMetrics,
  getProductMetrics,
  getLowStockCount,
  getCustomerMetrics,
  getPendingReviewCount,
  listRecentOrders,
  // helpers
  buildSet,
};
