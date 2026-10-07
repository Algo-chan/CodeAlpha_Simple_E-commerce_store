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
import { config } from '../config.js';

/**
 * Bumped to 2 when variant and product ids became UUIDs and the persisted
 * projection was tightened to the basket only. Version 1 entries reference
 * numeric ids that can never match again.
 */
export const CART_STORAGE_VERSION = 2;

/** Mirrors the Phase 2 constraint, so the UI cannot offer an order the DB rejects. */
export const MAX_QUANTITY = 10;

/**
 * The free-delivery threshold, re-exported because components read it from here.
 *
 * Sourced from config rather than recomputed, so the cart's progress hint and the
 * `freeDeliveryNotice` copy in the templates are the same number. Two literals
 * meant two answers the moment one of them was edited.
 */
export const FREE_SHIPPING_THRESHOLD_MINOR = config.freeShippingThreshold;

const initialState = {
  /** @type {Array<{id?:string|null, variantId:string, productId:string, slug:string,
   *                name:string, variantName:string|null, image:string|null,
   *                unitPrice:number, compareAtPrice?: number|null, quantity:number,
   *                maxQuantity:number, available?: number|null,
   *                unavailableReason?: 'missing'|'inactive'|'sold-out'|null}>} */
  lines: [],
  isOpen: false,
  /** Product id of the most recent add, so a card can flash "Added". */
  lastAddedVariantId: null,
  /**
   * Server-sync lifecycle. `idle` when no client is wired (the legacy pure-local
   * store), `syncing` while a request is in flight, `ready` after the server has
   * confirmed a cart, `error` after a failed request.
   * @type {'idle'|'syncing'|'ready'|'error'}
   */
  syncStatus: 'idle',
  syncError: null,
};

/**
 * @param {{ resolveVariant?: (variantId:number) => object|null,
 *           client?: { get:(p:string)=>Promise<object>, post:(p:string, b?:object)=>Promise<object>,
 *                      patch:(p:string, b?:object)=>Promise<object>, delete:(p:string)=>Promise<object> } | null }} [deps]
 */
export function createCartStore(deps = {}) {
  const { resolveVariant = () => null, client = null } = deps;

  const store = createStore(initialState, {
    name: 'cart',
    persist: {
      key: 'cart',
      version: CART_STORAGE_VERSION,
      // Only persist the basket, never `isOpen`: a reload should not reopen
      // the drawer over the page the shopper actually asked for. Sync metadata
      // is session state and is intentionally not persisted either.
      select: ({ lines, lastAddedVariantId }) => ({ lines, lastAddedVariantId }),
    },
  });

  /* --- Server sync --------------------------------------------------------- */

  /** One serial promise chain: mutations reach the server in tap order. */
  let chain = Promise.resolve();
  function enqueue(task) {
    const result = chain.then(task, task);
    chain = result.catch(() => {});
    return result;
  }

  function setSyncStatus(status, error = null) {
    store.setState({ syncStatus: status, syncError: error });
  }

  /**
   * Maps one server line onto the store's line shape. `id` is the cart-item
   * row id the later PATCH/DELETE targets; everything else renders unchanged.
   */
  function fromServerItem(item) {
    return {
      id: item.id != null ? String(item.id) : null,
      variantId: String(item.variantId),
      productId: item.productId != null ? String(item.productId) : null,
      slug: item.slug ?? '',
      name: item.name ?? '',
      variantName: item.variantName ?? null,
      image: item.image ?? null,
      unitPrice: Number(item.unitPrice) || 0,
      compareAtPrice: item.compareAtPrice == null ? null : Number(item.compareAtPrice),
      quantity: Math.max(1, Number(item.quantity) || 1),
      maxQuantity: item.maxQuantity == null ? MAX_QUANTITY : Number(item.maxQuantity),
      available: item.available == null ? null : Number(item.available),
      unavailableReason: item.unavailableReason || null,
    };
  }

  /**
   * Replaces the basket with the server's, the only authoritative one.
   *
   * `markReady` stays false during an error rollback so a truthful
   * `syncError` is not immediately painted over by the very request that
   * restored the basket.
   */
  function applyServerCart(cart, { markReady = true } = {}) {
    if (!cart || !Array.isArray(cart.items)) return;
    store.setState((prev) => ({
      lines: cart.items.map(fromServerItem),
      lastAddedVariantId: prev.lastAddedVariantId,
      ...(markReady ? { syncStatus: 'ready', syncError: null } : {}),
    }));
  }

  /**
   * Runs one server mutation, then replaces the basket with the server's view
   * of it. On failure the optimistic line is rolled back to whatever the
   * server last held (best effort) and the error is recorded, so the drawer
   * can say what went wrong instead of quietly keeping fiction on screen.
   *
   * @param {() => Promise<{cart:object}>} operation
   */
  function pushToServer(operation) {
    if (!client) return Promise.resolve(null);
    return enqueue(async () => {
      setSyncStatus('syncing');
      try {
        const data = await operation();
        applyServerCart(data?.cart);
        return data;
      } catch (error) {
        setSyncStatus('error', error);
        try {
          const before = await client.get('/cart');
          applyServerCart(before?.cart, { markReady: false });
        } catch {
          /* offline: the optimistic basket stays visible under the error */
        }
        return null;
      }
    });
  }

  /**
   * Reads the server cart and adopts it. Guests get (or continue) the cookie
   * cart; a signed-in shopper's request is the one that triggers the server's
   * login merge when a guest cookie is still attached.
   * @returns {Promise<object|null>}
   */
  function hydrate() {
    if (!client) return Promise.resolve(null);
    return enqueue(async () => {
      setSyncStatus('syncing');
      try {
        const data = await client.get('/cart');
        applyServerCart(data?.cart);
        return data;
      } catch (error) {
        setSyncStatus('error', error);
        return null;
      }
    });
  }

  /**
   * Adds a variant, or increases the quantity if it is already in the basket.
   *
   * Takes the variant id, because that is what a product card and the quick
   * view hold on to; an already-resolved variant is accepted too, so a caller
   * holding the whole object does not have to look it up again.
   * @param {number|string|object} variantOrId a variant id, or the variant
   * @param {number} [quantity]
   * @returns {{ ok:boolean, reason?:string, quantity?:number }}
   */
  function add(variantOrId, quantity = 1) {
    // An id has to go through `resolveVariant` for the line to get a name,
    // price and image. Reading `id` and `price_minor` straight off a string
    // instead filed the variant under `undefined` at zero cost, which rendered
    // as an unnamed, free line in the drawer.
    const variant =
      typeof variantOrId === 'object' && variantOrId !== null
        ? variantOrId
        : resolveVariant(variantOrId);
    if (!variant) return { ok: false, reason: 'unavailable' };

    // `is_active` lives on the VARIANT, not on the stock row. Reading
    // `stock.is_active` works only against the fixture shape, so the moment real
    // data arrived — where the stock object is `{quantity, reserved, available,
    // is_tracked}` — the check would read `undefined` and quietly let a
    // deactivated variant into the basket.
    if (variant.is_active === false) return { ok: false, reason: 'unavailable' };

    // Belt and braces: `is_purchasable` is what the server computed, so trust it
    // over re-deriving the same conclusion from `stock` here. A disagreement
    // between the two means the server knows something this client does not.
    if (variant.is_purchasable === false) return { ok: false, reason: 'unavailable' };

    const requested = clampQuantity(quantity, 1, MAX_QUANTITY);
    const existing = store.getState().lines.find((line) => line.variantId === variant.id);

    // A digital good has no inventory row, so there is no ceiling beyond the
    // per-order limit. A tracked variant is capped at what is on hand.
    const ceiling = resolveCeiling(variant);

    // Guarded on `existing`, not on `ceiling`: an untracked (digital) line has no
    // stock ceiling yet still has to grow when it is added again, otherwise the
    // second tap reported success and left the quantity exactly where it was.
    if (existing) {
      const ceilingForLine = ceiling ?? MAX_QUANTITY;
      const next = Math.min(existing.quantity + requested, ceilingForLine);
      if (next === existing.quantity) return { ok: false, reason: 'max-stock' };
      applyQuantity(variant.id, next);
      if (client) {
        // The server sums duplicate variants itself, so the POST reflects the
        // tap's own quantity and the server resolves the merged line.
        void pushToServer(() =>
          client.post('/cart/items', { variantId: String(variant.id), quantity: requested })
        );
      }
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

    if (client) {
      void pushToServer(() =>
        client.post('/cart/items', { variantId: String(line.variantId), quantity: requested })
      );
    }

    return { ok: true, quantity: requested };
  }

  /** Local-only quantity change; the public methods enqueue their own sync. */
  function applyQuantity(variantId, quantity) {
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

  /** @param {number} variantId */
  function setQuantity(variantId, quantity) {
    const result = applyQuantity(variantId, quantity);
    if (client && result.ok) {
      const line = store.getState().lines.find((item) => item.variantId === variantId);
      // A line with no server id was added while offline; PATCHing a phantom
      // id cannot reach it, and the failed add already surfaced the error.
      if (line?.id) {
        void pushToServer(() =>
          client.patch(`/cart/items/${line.id}`, { quantity: result.quantity })
        );
      }
    }
    return result;
  }

  /** Nudges by `delta`, used by the quantity stepper. */
  function step(variantId, delta) {
    const line = store.getState().lines.find((item) => item.variantId === variantId);
    if (!line) return { ok: false, reason: 'not-in-cart' };
    return setQuantity(variantId, line.quantity + delta);
  }

  /** @param {string} variantId */
  function remove(variantId) {
    const line = store.getState().lines.find((item) => item.variantId === variantId);
    store.setState((prev) => ({
      lines: prev.lines.filter((item) => item.variantId !== variantId),
      lastAddedVariantId: prev.lastAddedVariantId === variantId ? null : prev.lastAddedVariantId,
    }));
    if (client && line?.id) {
      void pushToServer(() => client.delete(`/cart/items/${line.id}`));
    }
  }

  /**
   * Puts a captured line back exactly as it was. This exists for undo.
   *
   * Rebuilding the line by re-adding a hand-assembled variant looks equivalent
   * and is not: a synthetic variant object carries no availability of its own,
   * so an undo could resurrect something that sold out a second ago. Restoring
   * the captured line keeps undo honest, and `reconcile` still re-checks it
   * against the catalogue.
   *
   * @param {object} line a previously removed line
   */
  function restoreLine(line) {
    if (!line || line.variantId === undefined) return { ok: false, reason: 'invalid' };

    const { lines } = store.getState();
    if (lines.some((item) => item.variantId === line.variantId)) {
      return { ok: false, reason: 'already-in-cart' };
    }

    store.setState((prev) => ({
      lines: [...prev.lines, { ...line, unavailableReason: null }],
      lastAddedVariantId: line.variantId,
    }));

    if (client) {
      // Undo re-adds by variant; the server dedupes and clamps, so re-POSTing
      // a known variant is how a restored line re-joins the authoritative cart.
      void pushToServer(() =>
        client.post('/cart/items', {
          variantId: String(line.variantId),
          quantity: Math.max(1, Number(line.quantity) || 1),
        })
      );
    }

    return { ok: true };
  }

  function clear() {
    store.setState({ lines: [], lastAddedVariantId: null });
    if (client) void pushToServer(() => client.delete('/cart'));
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
   *
   * An unbuyable line is FLAGGED, not deleted. Silently dropping it would make
   * a basket change without explanation, and a shopper who comes back to a
   * smaller basket has no way to tell whether they imagined the item. Flagging
   * lets the drawer say "no longer available" and offer removal, which is the
   * only honest handling of a line that cannot be bought.
   */
  function reconcile() {
    const { lines } = store.getState();
    if (lines.length === 0) return;

    let changed = false;
    const next = lines.map((line) => {
      const variant = resolveVariant(line.variantId);

      if (!variant) {
        changed = true;
        return { ...line, unavailableReason: 'missing' };
      }

      // Variant-level flag. See the note in `add`: this is not `stock.is_active`.
      if (variant.is_active === false) {
        changed = true;
        return { ...line, unavailableReason: 'inactive' };
      }

      const ceiling = resolveCeiling(variant);
      // `stock === null` means digital or untracked, so there is no ceiling — the
      // line stays buyable. Only a tracked row that is genuinely empty is sold
      // out, and treating "untracked" as "empty" would mark every download
      // unfulfillable.
      const unavailableReason = ceiling !== null && ceiling <= 0 ? 'sold-out' : null;
      const quantity =
        unavailableReason === 'sold-out'
          ? line.quantity
          : ceiling === null
            ? line.quantity
            : Math.min(line.quantity, Math.max(1, ceiling));
      const unitPrice = Number(variant.price_minor) || 0;

      const updated = {
        ...line,
        name: variant.product?.name ?? line.name,
        slug: variant.product?.slug ?? line.slug,
        image: variant.product?.primary_image ?? line.image,
        unitPrice,
        quantity,
        maxQuantity: ceiling ?? MAX_QUANTITY,
        unavailableReason,
      };

      if (
        quantity !== line.quantity ||
        unitPrice !== line.unitPrice ||
        unavailableReason !== (line.unavailableReason ?? null)
      ) {
        changed = true;
      }

      return updated;
    });

    if (changed) store.setState({ lines: next });
  }

  /* --- Derived values -------------------------------------------------------- */

  const selectLines = store.select(({ lines }) =>
    lines.map((line) => ({ ...line, lineTotal: line.unitPrice * line.quantity }))
  );

  const selectCount = store.select(({ lines }) =>
    lines.reduce((total, line) => total + (line.unavailableReason ? 0 : line.quantity), 0)
  );

  /**
   * Totals ignore flagged lines.
   *
   * A line that can no longer be bought must not inflate the subtotal or count
   * towards free delivery - the shopper would be told they qualify for free
   * shipping on the strength of an item they cannot order, and would then find
   * out at checkout. It stays in `lines` so the drawer can explain itself.
   */
  const selectSubtotal = store.select(({ lines }) =>
    lines.reduce(
      (total, line) => total + (line.unavailableReason ? 0 : line.unitPrice * line.quantity),
      0
    )
  );

  const selectIsEmpty = store.select(({ lines }) => lines.length === 0);

  const selectSyncStatus = store.select(({ syncStatus }) => syncStatus);
  const selectSyncError = store.select(({ syncError }) => syncError);

  /** True when every line has been flagged, i.e. nothing in here is buyable. */
  const selectIsUnfulfillable = store.select(
    ({ lines }) => lines.length > 0 && lines.every((line) => Boolean(line.unavailableReason))
  );

  const selectShippingProgress = store.select(({ lines }) => {
    const subtotal = lines.reduce(
      (total, line) => total + (line.unavailableReason ? 0 : line.unitPrice * line.quantity),
      0
    );
    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD_MINOR - subtotal);
    return {
      remaining,
      qualifies: subtotal >= FREE_SHIPPING_THRESHOLD_MINOR,
      // A zero subtotal would divide by the threshold and produce NaN, which
      // renders as a bar with no width rather than an empty one.
      percent:
        subtotal <= 0
          ? 0
          : Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD_MINOR) * 100)),
    };
  });

  return {
    ...store,
    add,
    setQuantity,
    step,
    remove,
    restoreLine,
    clear,
    open,
    close,
    toggle,
    reconcile,
    hydrate,
    selectLines,
    selectCount,
    selectSubtotal,
    selectIsEmpty,
    selectIsUnfulfillable,
    selectShippingProgress,
    selectSyncStatus,
    selectSyncError,
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
 * Maximum purchasable quantity for a variant, or `null` when unbounded.
 *
 * `null` is load-bearing. A variant with no inventory row is digital or
 * deliberately untracked, and `null` says "no ceiling exists" — which is not the
 * same claim as a ceiling of zero. Conflating them marks every download sold out.
 *
 * Prefers `available` (quantity minus reserved) over the raw `quantity`:
 * reserved units are committed to someone else's order, and offering them here is
 * exactly how a mock becomes an oversell once real stock lands behind it.
 *
 * @param {object} variant
 * @returns {number|null}
 */
function resolveCeiling(variant) {
  const stock = variant.stock;
  // Explicit `null` check, not falsiness. `available: 0` is a real, meaningful
  // value that must survive to the caller as a zero ceiling.
  if (stock === null || stock === undefined) return null;

  const available = stock.available ?? stock.quantity;
  if (available === null || available === undefined) return null;

  const count = Number(available);
  if (!Number.isFinite(count)) return null;

  return Math.min(Math.max(count, 0), MAX_QUANTITY);
}

/**
 * A short human label for a variant: "Black / Large" or the SKU when the
 * product has no attribute options.
 * @param {object|null} attributes
 */
export function describeVariant(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  const parts = Object.values(attributes)
    .map((value) => (typeof value === 'object' ? (value?.label ?? value?.name ?? '') : value))
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(String);
  return parts.length > 0 ? parts.join(' / ') : null;
}

export default { createCartStore, describeVariant, MAX_QUANTITY, FREE_SHIPPING_THRESHOLD_MINOR };
