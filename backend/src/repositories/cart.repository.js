/**
 * Cart repository — the only place allowed to run cart SQL.
 *
 * Two ownership models share one table (the schema enforces exactly one):
 *   - authenticated shoppers  → `carts.user_id`, one ACTIVE cart per user
 *     (partial unique index);
 *   - guests                  → `carts.session_token`, which stores the
 *     SHA-256 hash of the opaque cookie token — never the raw value, mirroring
 *     how `user_sessions` stores `token_hash`. One ACTIVE cart per token.
 *
 * All multi-statement flows run through `runInTransaction`, and the locking
 * helpers (`lockVariant`, `lockInventory`, `FOR UPDATE` finds) exist so that
 * "validate stock, then write" cannot interleave with a concurrent mutation.
 */
import crypto from 'node:crypto';
import { query as poolQuery } from '../config/db.js';

function executor(db) {
  return db.query ?? poolQuery;
}

/**
 * Row count for the last write. `pg` reports `rowCount`; PGlite reports
 * `affectedRows`; both semantics are "rows touched", so reading either keeps
 * the repository honest against both engines.
 */
function changed(result) {
  const n = result?.rowCount ?? result?.affectedRows ?? 0;
  return Number(n) > 0;
}

/** Number of rows touched (best effort across engines), for counts that need it. */
function rowsAffected(result) {
  return Number(result?.rowCount ?? result?.affectedRows ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Guest session tokens                                                        */
/* -------------------------------------------------------------------------- */

/** Raw cookie value for a guest cart: 64 hex chars from 32 random bytes. */
export function generateCartToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** What actually lands in `carts.session_token` — the hash, never the raw token. */
export function hashCartToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Carts                                                                       */
/* -------------------------------------------------------------------------- */

export async function findActiveByUser(db, userId, { forUpdate = false } = {}) {
  const result = await executor(db)(
    `SELECT * FROM carts
      WHERE user_id = $1 AND status = 'ACTIVE'
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function findActiveByTokenHash(db, tokenHash, { forUpdate = false } = {}) {
  const result = await executor(db)(
    `SELECT * FROM carts
      WHERE session_token = $1 AND status = 'ACTIVE'
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function insertCart(db, { userId = null, sessionTokenHash = null, expiresAt = null }) {
  const result = await executor(db)(
    `INSERT INTO carts (user_id, session_token, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, sessionTokenHash, expiresAt]
  );
  return result.rows[0];
}

/** Retires an expired guest cart so its token can be reissued. */
export async function abandonCart(db, cartId) {
  const result = await executor(db)(
    `UPDATE carts SET status = 'ABANDONED' WHERE id = $1 AND status = 'ACTIVE'`,
    [cartId]
  );
  return changed(result);
}

/** Marks a guest cart as consumed by the merge; the row stays for traceability. */
export async function convertCart(db, { guestCartId, userCartId }) {
  const result = await executor(db)(
    `UPDATE carts
        SET status = 'CONVERTED', merged_into_cart_id = $2
      WHERE id = $1 AND status = 'ACTIVE'`,
    [guestCartId, userCartId]
  );
  return changed(result);
}

/* -------------------------------------------------------------------------- */
/* Cart items                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One row per cart line with everything a view or a merge decision needs:
 * variant state, product state, live availability and the primary image.
 *
 * `available` is NULL exactly like the catalogue models it: no inventory row
 * means untracked (digital), zero means sold out. Collapsing the two would
 * mark every download unavailable.
 */
const ITEM_SELECT = `
  SELECT
    ci.id,
    ci.cart_id,
    ci.variant_id,
    ci.quantity,
    ci.updated_at,
    v.id              AS variant_row_id,
    v.price,
    v.compare_at_price,
    v.attributes,
    v.is_active,
    p.id              AS product_id,
    p.slug,
    p.name            AS product_name,
    p.status          AS product_status,
    i.quantity        AS stock_quantity,
    i.reserved_quantity,
    (i.quantity - i.reserved_quantity) AS available,
    img.image_url     AS primary_image
  FROM cart_items ci
  LEFT JOIN product_variants v ON v.id = ci.variant_id
  LEFT JOIN products p         ON p.id = v.product_id
  LEFT JOIN inventory i        ON i.variant_id = ci.variant_id
  LEFT JOIN LATERAL (
    SELECT image_url
      FROM product_images pi
     WHERE pi.product_id = p.id
     ORDER BY pi.is_primary DESC, pi.sort_order, pi.id
     LIMIT 1
  ) img ON TRUE`;

export async function listItems(db, cartId) {
  const result = await executor(db)(
    `${ITEM_SELECT}
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at ASC, ci.id ASC`,
    [cartId]
  );
  return result.rows;
}

export async function findItem(db, cartId, itemId, { forUpdate = false } = {}) {
  const result = await executor(db)(
    `SELECT * FROM cart_items
      WHERE id = $1 AND cart_id = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [itemId, cartId]
  );
  return result.rows[0] ?? null;
}

export async function findItemByVariant(db, cartId, variantId, { forUpdate = false } = {}) {
  const result = await executor(db)(
    `SELECT * FROM cart_items
      WHERE cart_id = $1 AND variant_id = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [cartId, variantId]
  );
  return result.rows[0] ?? null;
}

export async function insertItem(db, { cartId, variantId, quantity }) {
  const result = await executor(db)(
    `INSERT INTO cart_items (cart_id, variant_id, quantity)
     VALUES ($1, $2, $3)
     RETURNING id, quantity`,
    [cartId, variantId, quantity]
  );
  return result.rows[0];
}

export async function updateItemQuantity(db, cartId, itemId, quantity) {
  const result = await executor(db)(
    `UPDATE cart_items SET quantity = $3, updated_at = NOW()
      WHERE id = $1 AND cart_id = $2`,
    [itemId, cartId, quantity]
  );
  return changed(result);
}

export async function deleteItem(db, cartId, itemId) {
  const result = await executor(db)(`DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`, [
    itemId,
    cartId,
  ]);
  return changed(result);
}

export async function clearItems(db, cartId) {
  const result = await executor(db)(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  return rowsAffected(result);
}

export async function countItems(db, cartId) {
  const result = await executor(db)(
    `SELECT COUNT(*)::int AS n FROM cart_items WHERE cart_id = $1`,
    [cartId]
  );
  return result.rows[0]?.n ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Locks                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Locks a variant (and reads its product state) so concurrent adds/updates of
 * the same variant serialise instead of racing past each other's stock check.
 * Returns null when the variant does not exist.
 */
export async function lockVariant(db, variantId) {
  const result = await executor(db)(
    `SELECT v.id, v.price, v.compare_at_price, v.attributes, v.is_active, v.product_id,
            p.slug, p.name AS product_name, p.status AS product_status
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1
      FOR UPDATE OF v`,
    [variantId]
  );
  return result.rows[0] ?? null;
}

/**
 * Locks the inventory row for a variant. A missing row is not an error: it is
 * how the schema models an untracked (digital) product, so callers treat null
 * as "unlimited".
 */
export async function lockInventory(db, variantId) {
  const result = await executor(db)(
    `SELECT quantity, reserved_quantity FROM inventory WHERE variant_id = $1 FOR UPDATE`,
    [variantId]
  );
  return result.rows[0] ?? null;
}

export default {
  generateCartToken,
  hashCartToken,
  findActiveByUser,
  findActiveByTokenHash,
  insertCart,
  abandonCart,
  convertCart,
  listItems,
  findItem,
  findItemByVariant,
  insertItem,
  updateItemQuantity,
  deleteItem,
  clearItems,
  countItems,
  lockVariant,
  lockInventory,
};
