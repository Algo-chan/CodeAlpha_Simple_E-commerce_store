/**
 * Wishlist repository — the only place allowed to run wishlist SQL.
 *
 * One wishlist per user (unique constraint on `user_id`), created lazily on
 * first read. Duplicates are prevented at the database level
 * (`wishlist_items_unique_product`), so `INSERT ... ON CONFLICT DO NOTHING`
 * makes `save` idempotent without a read-then-write race.
 */
import { query as poolQuery } from '../config/db.js';

function executor(db) {
  return db.query ?? poolQuery;
}

const ITEM_SELECT = `
  SELECT
    wi.product_id,
    wi.created_at AS saved_at,
    p.slug,
    p.name,
    p.status,
    img.image_url AS primary_image,
    (SELECT MIN(v.price)
       FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active = TRUE) AS price_minor
  FROM wishlist_items wi
  JOIN products p ON p.id = wi.product_id
  LEFT JOIN LATERAL (
    SELECT image_url
      FROM product_images pi
     WHERE pi.product_id = p.id
     ORDER BY pi.is_primary DESC, pi.sort_order, pi.id
     LIMIT 1
  ) img ON TRUE`;

export async function findByUser(db, userId) {
  const result = await executor(db)(`SELECT * FROM wishlists WHERE user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}

/** Gets-or-creates the shopper's wishlist; the unique index makes this race-safe. */
export async function ensureWishlist(db, userId) {
  const inserted = await executor(db)(
    `INSERT INTO wishlists (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId]
  );
  if (inserted.rows[0]) return inserted.rows[0];
  return findByUser(db, userId);
}

/**
 * Active products only: an archived product must not surface in a saved list,
 * and the storefront cannot render it anyway.
 */
export async function listItems(db, wishlistId) {
  const result = await executor(db)(
    `${ITEM_SELECT}
      WHERE wi.wishlist_id = $1 AND p.status = 'ACTIVE'
      ORDER BY wi.created_at DESC, wi.id DESC`,
    [wishlistId]
  );
  return result.rows;
}

/** Returns true when the row was newly saved, false when it already existed. */
export async function insertItem(db, wishlistId, productId) {
  const result = await executor(db)(
    `INSERT INTO wishlist_items (wishlist_id, product_id)
     VALUES ($1, $2)
     ON CONFLICT (wishlist_id, product_id) DO NOTHING
     RETURNING id`,
    [wishlistId, productId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteItem(db, wishlistId, productId) {
  const result = await executor(db)(
    `DELETE FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2`,
    [wishlistId, productId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** The ids out of `productIds` that exist and are currently active. */
export async function findActiveProductIds(db, productIds) {
  if (!productIds || productIds.length === 0) return [];
  const result = await executor(db)(
    `SELECT id FROM products
      WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
    [productIds]
  );
  return result.rows.map((row) => String(row.id));
}

export async function findProduct(db, productId) {
  const result = await executor(db)(`SELECT id, status FROM products WHERE id = $1`, [productId]);
  return result.rows[0] ?? null;
}

export default {
  findByUser,
  ensureWishlist,
  listItems,
  insertItem,
  deleteItem,
  findActiveProductIds,
  findProduct,
};
