/**
 * Cart state.
 *
 * MONEY RULE, restated because this is where it is most likely to be broken:
 * every price here is an integer number of ETB minor units, exactly as the
 * database stores it. A line total is `unit_price_minor * quantity`, an
 * integer multiply. Division happens once, in the formatter, at render time.
 *
 * Lines carry a snapshot of name, slug and image alongside the id. That is
 * deliberate: the cart must still render if a product is renamed, archived or
 * deleted, and it means opening the drawer never has to await a lookup. Stock
 * and price are re-checked against live data by `resolveVariant`, which the
 * app injects once the mock catalogue is available.
 */
import { createStore } from './store.js';
import { majorToMinor } from '../utils/format.js';

export const CART_STORAGE_VERSION = 1;

/** Mirrors the Phase 2 constraint, so the UI cannot offer an order the DB rejects. */
export const MAX_QUANTITY = 10;

/** ETB 5,000 in minor units. Drives the free-shipping progress hint. */
export const FREE_SHIPPING_THRESHOLD_MINOR = majorToMinor(5000);

const initialState = {
  /** @type {Array<{variantId:number, productId:number, slug:string, name:string,
   *                variantName:string|null, image:string|null,
   *                unitPrice:number, quantity:number, maxQuantity:number}>} */
  lines: [],
  isOpen: false,
  /** Product id of the most recent add, so a card can flash "Added". */
  lastAddedVariantId: null,
};

/**
 * @param {{ resolveVariant?: (variantId:number) => object|null }} [deps]
 */
export function createCartStore(deps = {}) {
  const { resolveVariant = () => null } = deps;

  const store = createStore(initialState, {
    name: 'cart',
    persist: {
      key: 'cart',
      version: CART_STORAGE_VERSION,
      // Only persist the basket, never `isOpen`: a reload should not reopen
      // the drawer over the page the shopper actually asked for.
      select: ({ lines, lastAddedVariantId }) => ({ lines, lastAddedVariantId }),
    },
  });

  /**
   * Adds a variant, or increases the quantity if it is already in the basket.
   * @param {{ id:number, product_id:number, price_minor:number,
   *           sku:string|null, attributes:object|null,
   *           product:{ slug:string, name:string, primary_image:string|null },
   *           stock:{ quantity:number|null, is_active:boolean } }} variant
   * @param {number} [quantity]
   * @returns {{ ok:boolean, reason?:string, quantity?:number }}
   */
  function add(variant, quantity = 1) {
    if (!variant) return { ok: false, reason: 'unavailable' };
    if (variant.stock && variant.stock.is_active === false) {
      return { ok: false, reason: 'unavailable' };
    }

    const requested = clampQuantity(quantity, 1, MAX_QUANTITY);
    const existing = store.getState().lines.find((line) => line.variantId === variant.id);

    // A digital good has no inventory row, so there is no ceiling beyond the
    // per-order limit. A tracked variant is capped at what is on hand.
    const ceiling = resolveCeiling(variant);

    if (ceiling !== null && existing) {
      const next = Math.min(existing.quantity + requested, ceiling);
      if (next === existing.quantity) return { ok: false, reason: 'max-stock' };
      setQuantity(variant.id, next);
      return { ok: true, quantity: next };
    }

    if (ceiling !== null && requested > ceiling) {
      return { ok: false, reason: 'max-stock' };
    }

    const line = {
      variantId: variant.id,
      productId: variant.product_id,
      slug: variant.product?.slug ?? '',
      name: variant.product?.name ?? '',
      variantName: describeVariant(variant.attributes),
      image: variant.product?.primary_image ?? null,
      unitPrice: Number(variant.price_minor) || 0,
      quantity: requested,
      maxQuantity: ceiling ?? MAX_QUANTITY,
    };

    store.setState((prev) => ({
      lines: prev.lines.some((item) => item.variantId === line.variantId)
        ? prev.lines
        : [...prev.lines, line],
      lastAddedVariantId: line.variantId,
    }));

    return { ok: true, quantity: requested };
  }

  /** @param {number} variantId */
  function setQuantity(variantId, quantity) {
    const { lines } = store.getState();
    const line = lines.find((item) => item.variantId === variantId);
    if (!line) return { ok: false, reason: 'not-in-cart' };

    const ceiling = line.maxQuantity ?? MAX_QUANTITY;
    const next = clampQuantity(quantity, 1, ceiling);

    if (next === line.quantity) return { ok: true, quantity: next };

    store.setState((prev) => ({
      lines: prev.lines.map((item) =>
        item.variantId === variantId ? { ...item, quantity: next } : item
      ),
    }));

    return { ok: true, quantity: next };
  }

  /** Nudges by `delta`, used by the quantity stepper. */
  function step(variantId, delta) {
    const line = store.getState().lines.find((item) => item.variantId === variantId);
    if (!line) return { ok: false, reason: 'not-in-cart' };
    return setQuantity(variantId, line.quantity + delta);
  }

  /** @param {number} variantId */
  function remove(variantId) {
    store.setState((prev) => ({
      lines: prev.lines.filter((item) => item.variantId !== variantId),
      lastAddedVariantId:
        prev.lastAddedVariantId === variantId ? null : prev.lastAddedVariantId,
    }));
  }

  function clear() {
    store.setState({ lines: [], lastAddedVariantId: null });
  }

  /* --- Drawer visibility ---------------------------------------------------- */

  function open() {
    store.setState({ isOpen: true });
  }

  function close() {
    store.setState({ isOpen: false });
  }

  function toggle() {
    store.setState((prev) => ({ isOpen: !prev.isOpen }));
  }

  /**
   * Re-reads price and availability from the catalogue.
   *
   * Called after the mock catalogue loads and whenever the shopper returns to
   * the tab. This is what stops a stale persisted basket from quoting a price
   * or a quantity that no longer exists.
   */
  function reconcile() {
    const { lines } = store.getState();
    if (lines.length === 0) return;

    const next = [];
    let changed = false;

    for (const line of lines) {
      const variant = resolveVariant(line.variantId);
      if (!variant || variant.stock?.is_active === false) {
        changed = true;
        continue; // The line is dropped; the UI reports it separately.
      }

      const ceiling = resolveCeiling(variant);
      const quantity =
        ceiling === null ? line.quantity : Math.min(line.quantity, Math.max(1, ceiling));
      const unitPrice = Number(variant.price_minor) || 0;

      if (quantity !== line.quantity || unitPrice !== line.unitPrice) changed = true;
      next.push({
        ...line,
        name: variant.product?.name ?? line.name,
        slug: variant.product?.slug ?? line.slug,
        image: variant.product?.primary_image ?? line.image,
        unitPrice,
        quantity,
        maxQuantity: ceiling ?? MAX_QUANTITY,
      });
    }

    if (changed) store.setState({ lines: next });
  }

  /* --- Derived values -------------------------------------------------------- */

  const selectLines = store.select(({ lines }) =>
    lines.map((line) => ({ ...line, lineTotal: line.unitPrice * line.quantity }))
  );

  const selectCount = store.select(({ lines }) =>
    lines.reduce((total, line) => total + line.quantity, 0)
  );

  const selectSubtotal = store.select(({ lines }) =>
    lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0)
  );

  const selectIsEmpty = store.select(({ lines }) => lines.length === 0);

  const selectShippingProgress = store.select(({ lines }) => {
    const subtotal = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD_MINOR - subtotal);
    return {
      remaining,
      qualifies: subtotal >= FREE_SHIPPING_THRESHOLD_MINOR,
      percent: Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD_MINOR) * 100)),
    };
  });

  return {
    ...store,
    add,
    setQuantity,
    step,
    remove,
    clear,
    open,
    close,
    toggle,
    reconcile,
    selectLines,
    selectCount,
    selectSubtotal,
    selectIsEmpty,
    selectShippingProgress,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

function clampQuantity(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

/**
 * Maximum purchasable quantity for a variant.
 * `null` means unbounded - the variant has no inventory row, which per Phase 2
 * means the item is digital and stock is not tracked.
 *
 * Prefers `available` (quantity minus reserved) over the raw `quantity`:
 * reserved units are committed to someone else's order, and offering them here
 * is exactly how a mock becomes an oversell once real stock lands behind it.
 */
function resolveCeiling(variant) {
  const stock = variant.stock;
  if (!stock) return null;
  const available = stock.available ?? stock.quantity;
  if (available === null || available === undefined) return null;
  return Math.min(Number(available), MAX_QUANTITY);
}

/**
 * A short human label for a variant: "Black / Large" or the SKU when the
 * product has no attribute options.
 * @param {object|null} attributes
 */
export function describeVariant(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  const parts = Object.values(attributes)
    .map((value) => (typeof value === 'object' ? value?.label ?? value?.name ?? '' : value))
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(String);
  return parts.length > 0 ? parts.join(' / ') : null;
}

export default { createCartStore, describeVariant, MAX_QUANTITY, FREE_SHIPPING_THRESHOLD_MINOR };