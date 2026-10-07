/**
 * Cart service — the authoritative cart domain.
 *
 * Three rules shape everything here:
 *
 *   1. THE SERVER OWNS PRICE, STOCK AND AVAILABILITY. No client-supplied price
 *      ever reaches a total; every mutation re-reads the variant, the product
 *      and the inventory row inside the same transaction that writes the cart,
 *      so a stale page or a lying client cannot corrupt totals or oversell.
 *
 *   2. GUESTS ARE IDENTIFIED BY AN OPAQUE COOKIE TOKEN, hashed before it
 *      touches the database. User ids are never accepted from a guest request;
 *      the only source of `userId` is the authenticated session resolved by
 *      the auth middleware.
 *
 *   3. LOGIN MERGES. When a signed-in shopper still carries a guest cart
 *      cookie, the guest cart is folded into the user cart (summing duplicate
 *      variants, clamped to live inventory) and retired as CONVERTED — the
 *      same guarantees the schema sketches in `merged_into_cart_id`.
 *
 * Inventory is never reserved at cart stage; availability is re-derived on
 * every read and every write, which is what keeps "cart display" and "cart
 * update" consistent when stock moves underneath the shopper.
 */
import AppError from '../utils/app-error.js';
import { CART_LIMITS, GUEST_CART_MAX_AGE_SECONDS } from '../config/constants.js';
import { runInTransaction } from '../utils/transaction.js';
import * as carts from '../repositories/cart.repository.js';
import { buildVariantLabel, normaliseAttributes } from './catalogue.view.js';

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

const variantNotFound = () =>
  new AppError('That option is no longer available.', 404, 'VARIANT_NOT_FOUND');

const productUnavailable = () =>
  new AppError('This product is not available for purchase.', 409, 'PRODUCT_UNAVAILABLE');

const insufficientStock = ({ available, requested, inCart }) =>
  new AppError(
    available > 0
      ? `Only ${available} unit${available === 1 ? '' : 's'} of this option can be in your cart.`
      : 'This option is sold out.',
    409,
    'INSUFFICIENT_STOCK',
    { available, requested, inCart }
  );

const cartItemNotFound = () =>
  new AppError('That item is no longer in your cart.', 404, 'CART_ITEM_NOT_FOUND');

const cartFull = () =>
  new AppError('Your cart is full. Remove an item to add a different one.', 409, 'CART_FULL');

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The ceiling for one line: the schema's hard cap of 100, further limited by
 * live availability. `available === null` (no inventory row) means untracked
 * — digital goods — and is deliberately NOT treated as zero.
 */
function lineCeiling(inventory) {
  if (!inventory) return CART_LIMITS.MAX_QUANTITY_PER_LINE;
  const available = Number(inventory.quantity) - Number(inventory.reserved_quantity);
  return Math.max(0, Math.min(CART_LIMITS.MAX_QUANTITY_PER_LINE, available));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Maps one joined cart row into the shape the storefront consumes.
 * `unavailableReason` mirrors the flags the drawer already understands:
 * missing / inactive / sold-out.
 */
function toLine(row) {
  const price = toNumber(row.price) ?? 0;
  const available =
    row.available === null || row.available === undefined ? null : Number(row.available);

  let unavailableReason = null;
  if (!row.variant_row_id || !row.product_id) unavailableReason = 'missing';
  else if (row.product_status !== 'ACTIVE' || row.is_active !== true)
    unavailableReason = 'inactive';
  else if (available !== null && available <= 0) unavailableReason = 'sold-out';

  const quantity = Number(row.quantity);

  return {
    id: String(row.id),
    variantId: String(row.variant_id),
    productId: row.product_id ? String(row.product_id) : null,
    slug: row.slug ?? '',
    name: row.product_name ?? '',
    variantName: buildVariantLabel(normaliseAttributes(row.attributes)),
    image: row.primary_image ?? null,
    unitPrice: price,
    compareAtPrice: toNumber(row.compare_at_price),
    quantity,
    maxQuantity:
      available === null
        ? CART_LIMITS.MAX_QUANTITY_PER_LINE
        : Math.max(0, Math.min(CART_LIMITS.MAX_QUANTITY_PER_LINE, available)),
    available,
    unavailableReason,
    lineTotal: price * quantity,
  };
}

/**
 * Repairs quantities that stock has moved under: when only part of a line is
 * now available, the line is reduced to what can actually be bought. Lines
 * that are fully out of stock keep their quantity and take the `sold-out`
 * flag instead — silently deleting the shopper's item would lose intent.
 *
 * This runs inside the caller's transaction, so display state and the next
 * update can never disagree about what the cart holds.
 */
async function repairQuantities(tx, cartId, lines) {
  for (const line of lines) {
    if (line.unavailableReason) continue;
    if (line.available === null) continue;
    if (line.quantity <= line.available) continue;

    const clamped = Math.max(1, Math.min(line.available, CART_LIMITS.MAX_QUANTITY_PER_LINE));
    const updated = await carts.updateItemQuantity(tx, cartId, line.id, clamped);
    if (updated) line.quantity = clamped;
    line.lineTotal = line.unitPrice * line.quantity;
  }
}

/** Builds the full cart view (items, count, subtotal) from the database. */
async function buildView(tx, cart) {
  const rows = await carts.listItems(tx, cart.id);
  const lines = rows.map(toLine);
  await repairQuantities(tx, cart.id, lines);

  const buyable = lines.filter((line) => !line.unavailableReason);
  const subtotal = buyable.reduce((total, line) => total + line.lineTotal, 0);
  const count = buyable.reduce((total, line) => total + line.quantity, 0);

  return {
    id: String(cart.id),
    owner: cart.user_id ? 'user' : 'guest',
    status: cart.status,
    items: lines,
    itemCount: lines.length,
    count,
    subtotal,
    updatedAt: cart.updated_at instanceof Date ? cart.updated_at.toISOString() : cart.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Cart resolution (identity + merge)                                          */
/* -------------------------------------------------------------------------- */

function isExpired(cart) {
  if (!cart.expires_at) return false;
  const expiresAt = new Date(cart.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

/**
 * Folds the guest cart into the user cart.
 *
 * Duplicate variants sum (guest 2 + user 1 = 3) but never past live
 * inventory or the schema's cap of 100; items whose variant or product is no
 * longer sellable, or that are sold out, are dropped rather than imported as
 * broken lines. Inventory and variant rows are locked first so the merge's
 * stock arithmetic is a snapshot, not a guess.
 */
async function mergeGuestCart(tx, guestCart, userCart) {
  const rows = await carts.listItems(tx, guestCart.id);

  for (const row of rows) {
    if (!row.variant_row_id || !row.product_id) continue;
    if (row.product_status !== 'ACTIVE' || row.is_active !== true) continue;

    await carts.lockVariant(tx, row.variant_id);
    const inventory = await carts.lockInventory(tx, row.variant_id);
    const ceiling = lineCeiling(inventory);
    if (ceiling <= 0) continue;

    const existing = await carts.findItemByVariant(tx, userCart.id, row.variant_id, {
      forUpdate: true,
    });
    const existingQuantity = existing ? existing.quantity : 0;
    const target = Math.min(existingQuantity + Number(row.quantity), ceiling);
    if (target < 1) continue;

    if (existing) {
      await carts.updateItemQuantity(tx, userCart.id, existing.id, target);
    } else {
      await carts.insertItem(tx, {
        cartId: userCart.id,
        variantId: row.variant_id,
        quantity: target,
      });
    }
  }

  await carts.clearItems(tx, guestCart.id);
  await carts.convertCart(tx, { guestCartId: guestCart.id, userCartId: userCart.id });
}

/**
 * Resolves the cart for this request and returns the cookie side effect the
 * controller must apply:
 *
 *   { issue: token } — a guest cart was created (or its stale token retired)
 *   { clear: true }  — the guest cookie is spent (merged or unknown)
 *   null             — nothing to do
 */
async function resolveCart(tx, { userId, guestToken }) {
  const tokenHash = guestToken ? carts.hashCartToken(guestToken) : null;

  if (userId) {
    let guestCart = tokenHash
      ? await carts.findActiveByTokenHash(tx, tokenHash, { forUpdate: true })
      : null;
    if (guestCart && isExpired(guestCart)) {
      await carts.abandonCart(tx, guestCart.id);
      guestCart = null;
    }

    let userCart = await carts.findActiveByUser(tx, userId, { forUpdate: true });
    if (!userCart) {
      try {
        userCart = await carts.insertCart(tx, { userId });
      } catch (error) {
        // A parallel request for the same shopper won the partial unique index.
        if (error?.code !== '23505') throw error;
        userCart = await carts.findActiveByUser(tx, userId, { forUpdate: true });
      }
    }

    if (guestCart && guestCart.id !== userCart.id) {
      await mergeGuestCart(tx, guestCart, userCart);
      return { cart: userCart, cookie: { clear: true }, merged: true };
    }
    if (tokenHash && !guestCart) return { cart: userCart, cookie: { clear: true }, merged: false };
    return { cart: userCart, cookie: null, merged: false };
  }

  let guestCart = tokenHash
    ? await carts.findActiveByTokenHash(tx, tokenHash, { forUpdate: true })
    : null;
  if (guestCart && isExpired(guestCart)) {
    await carts.abandonCart(tx, guestCart.id);
    guestCart = null;
  }
  if (guestCart) return { cart: guestCart, cookie: null, merged: false };

  const token = carts.generateCartToken();
  const created = await carts.insertCart(tx, {
    sessionTokenHash: carts.hashCartToken(token),
    expiresAt: new Date(Date.now() + GUEST_CART_MAX_AGE_SECONDS * 1000),
  });
  return { cart: created, cookie: { issue: token }, merged: false };
}

/* -------------------------------------------------------------------------- */
/* Shared preconditions for mutations                                          */
/* -------------------------------------------------------------------------- */

/** Locks + validates the target variant and returns its live ceiling. */
async function lockPurchasable(tx, variantId) {
  const variant = await carts.lockVariant(tx, variantId);
  if (!variant) throw variantNotFound();
  if (variant.is_active !== true || variant.product_status !== 'ACTIVE') {
    throw productUnavailable();
  }
  const inventory = await carts.lockInventory(tx, variantId);
  return { variant, inventory, ceiling: lineCeiling(inventory) };
}

/**
 * Adds (or merges into) a line. The duplicate-variant case sums quantities,
 * which is the same arithmetic the login merge performs — one ceiling, one
 * source of truth: the inventory row just locked.
 */
export async function addItem(db, context, { variantId, quantity }) {
  return runInTransaction(db, async (tx) => {
    const { cart, cookie, merged } = await resolveCart(tx, context);
    const { ceiling } = await lockPurchasable(tx, variantId);

    const existing = await carts.findItemByVariant(tx, cart.id, variantId, {
      forUpdate: true,
    });
    const inCart = existing ? existing.quantity : 0;
    const target = inCart + quantity;

    if (target > ceiling || target > CART_LIMITS.MAX_QUANTITY_PER_LINE) {
      throw insufficientStock({
        available: Math.min(ceiling, CART_LIMITS.MAX_QUANTITY_PER_LINE),
        requested: quantity,
        inCart,
      });
    }
    if (!existing && (await carts.countItems(tx, cart.id)) >= CART_LIMITS.MAX_LINES) {
      throw cartFull();
    }

    if (existing) {
      await carts.updateItemQuantity(tx, cart.id, existing.id, target);
    } else {
      await carts.insertItem(tx, { cartId: cart.id, variantId, quantity: target });
    }

    return { cart: await buildView(tx, cart), cookie, merged };
  });
}

/** Sets a line to an exact quantity, re-validated against live stock. */
export async function updateItem(db, context, itemId, { quantity }) {
  return runInTransaction(db, async (tx) => {
    const { cart, cookie, merged } = await resolveCart(tx, context);

    const item = await carts.findItem(tx, cart.id, itemId, { forUpdate: true });
    if (!item) throw cartItemNotFound();

    const { ceiling } = await lockPurchasable(tx, item.variant_id);
    if (quantity > ceiling) {
      throw insufficientStock({
        available: Math.min(ceiling, CART_LIMITS.MAX_QUANTITY_PER_LINE),
        requested: quantity,
        inCart: 0,
      });
    }

    await carts.updateItemQuantity(tx, cart.id, item.id, quantity);
    return { cart: await buildView(tx, cart), cookie, merged };
  });
}

/** Removes one line. Scoped to the caller's cart — ids from other carts 404. */
export async function removeItem(db, context, itemId) {
  return runInTransaction(db, async (tx) => {
    const { cart, cookie, merged } = await resolveCart(tx, context);
    const removed = await carts.deleteItem(tx, cart.id, itemId);
    if (!removed) throw cartItemNotFound();
    return { cart: await buildView(tx, cart), cookie, merged };
  });
}

/** Empties the cart but keeps the cart row (and its guest identity). */
export async function clearCart(db, context) {
  return runInTransaction(db, async (tx) => {
    const { cart, cookie, merged } = await resolveCart(tx, context);
    await carts.clearItems(tx, cart.id);
    return { cart: await buildView(tx, cart), cookie, merged };
  });
}

/** Reads the cart, repairing any line stock has moved under. */
export async function getCart(db, context) {
  return runInTransaction(db, async (tx) => {
    const { cart, cookie, merged } = await resolveCart(tx, context);
    return { cart: await buildView(tx, cart), cookie, merged };
  });
}

export default { getCart, addItem, updateItem, removeItem, clearCart };
