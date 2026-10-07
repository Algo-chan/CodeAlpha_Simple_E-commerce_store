/**
 * Wishlist service — saved-for-later, server-side.
 *
 * The wishlist is keyed by user id, and the only source of that id is the
 * authenticated session, so one shopper can never read or write another's
 * list. Duplicates are impossible: the unique index plus
 * `ON CONFLICT DO NOTHING` makes save idempotent without a race window.
 *
 * Guest wishlists live in the browser until sign-in (there is no guest
 * identity to attach them to); the merge endpoint folds that local list into
 * the customer list in one validated, duplicate-safe pass.
 */
import AppError from '../utils/app-error.js';
import { WISHLIST_LIMITS } from '../config/constants.js';
import { runInTransaction } from '../utils/transaction.js';
import * as wishlists from '../repositories/wishlist.repository.js';

const productNotFound = () =>
  new AppError('That product is no longer available.', 404, 'PRODUCT_NOT_FOUND');

/** Server view of one saved item; the storefront keys on `productId`. */
function toItem(row) {
  return {
    productId: String(row.product_id),
    slug: row.slug,
    name: row.name,
    image: row.primary_image ?? null,
    priceMinor: row.price_minor === null || row.price_minor === undefined
      ? null
      : Number(row.price_minor),
    savedAt: row.saved_at instanceof Date ? row.saved_at.toISOString() : row.saved_at,
  };
}

async function readWishlist(tx, userId) {
  const wishlist = await wishlists.ensureWishlist(tx, userId);
  const rows = await wishlists.listItems(tx, wishlist.id);
  return {
    id: String(wishlist.id),
    name: wishlist.name,
    items: rows.map(toItem),
    count: rows.length,
  };
}

/** `GET /api/v1/wishlist` */
export async function getWishlist(db, userId) {
  return runInTransaction(db, (tx) => readWishlist(tx, userId));
}

/** `POST /api/v1/wishlist/items` — idempotent; already-saved products stay saved. */
export async function addItem(db, userId, productId) {
  return runInTransaction(db, async (tx) => {
    const product = await wishlists.findProduct(tx, productId);
    if (!product || product.status !== 'ACTIVE') throw productNotFound();

    const wishlist = await wishlists.ensureWishlist(tx, userId);
    await wishlists.insertItem(tx, wishlist.id, productId);
    return readWishlist(tx, userId);
  });
}

/** `DELETE /api/v1/wishlist/items/:productId` — idempotent by design. */
export async function removeItem(db, userId, productId) {
  return runInTransaction(db, async (tx) => {
    const wishlist = await wishlists.ensureWishlist(tx, userId);
    await wishlists.deleteItem(tx, wishlist.id, productId);
    return readWishlist(tx, userId);
  });
}

/**
 * `POST /api/v1/wishlist/merge` — folds the guest's local list into the
 * customer list after sign-in.
 *
 * Unknown or archived products are skipped rather than failing the whole
 * merge: a stale local id is expected, not an error. The DB's unique index
 * is what makes re-merging safe, so the client can retry freely.
 */
export async function merge(db, userId, productIds) {
  return runInTransaction(db, async (tx) => {
    const unique = [...new Set(productIds.map(String))].slice(
      0,
      WISHLIST_LIMITS.MAX_MERGE_IDS
    );
    const activeIds = await wishlists.findActiveProductIds(tx, unique);
    const wishlist = await wishlists.ensureWishlist(tx, userId);

    let added = 0;
    for (const productId of activeIds) {
      if (await wishlists.insertItem(tx, wishlist.id, productId)) added += 1;
    }

    const view = await readWishlist(tx, userId);
    return { ...view, added, skipped: unique.length - activeIds.length };
  });
}

export default { getWishlist, addItem, removeItem, merge };
