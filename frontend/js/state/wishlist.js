/**
 * Wishlist state.
 *
 * Per Phase 2, wishlist rows target a PRODUCT, not a variant - the shopper
 * saves the thing, and picks a size later. So the store holds product ids only
 * and never price or stock, which also means it stays valid when variants
 * change.
 */
import { createStore } from './store.js';

/**
 * Bumped to 2 when product ids became UUIDs, so version 1 entries - which hold
 * numeric ids that can never match again - are discarded instead of sitting in
 * the list doing nothing.
 */
export const WISHLIST_STORAGE_VERSION = 2;

const initialState = {
  /** @type {string[]} product UUIDs, most recently added first */
  productIds: [],
  /**
   * Server-sync lifecycle for signed-in shoppers. Guests have no server list,
   * so this stays `idle` for them and every operation stays purely local.
   * @type {'idle'|'syncing'|'ready'|'error'}
   */
  syncStatus: 'idle',
  syncError: null,
};

/**
 * Ids are UUIDs. Normalising to string here keeps `has()` honest whether the
 * caller passes a string from the catalogue or a value straight off the URL.
 * @param {unknown} productId
 * @returns {string|null}
 */
function normaliseId(productId) {
  if (productId === null || productId === undefined || productId === '') return null;
  return String(productId);
}

/**
 * @param {{ client?: object|null,
 *           isAuthenticated?: () => boolean }} [deps]
 * @returns {ReturnType<typeof createStore> & {...}}
 */
export function createWishlistStore(deps = {}) {
  const { client = null, isAuthenticated = () => false } = deps;

  const store = createStore(initialState, {
    name: 'wishlist',
    persist: {
      key: 'wishlist',
      version: WISHLIST_STORAGE_VERSION,
      // Sync metadata describes the server relationship, which is per-session;
      // only the saved ids belong in storage.
      select: ({ productIds }) => ({ productIds }),
    },
  });

  /** The server owns a list only once there is a shopper to attach it to. */
  function serverEnabled() {
    return Boolean(client && isAuthenticated());
  }

  /** One serial promise chain, so a burst of hearts arrives in tap order. */
  let chain = Promise.resolve();
  function enqueue(task) {
    const result = chain.then(task, task);
    chain = result.catch(() => {});
    return result;
  }

  function setSyncStatus(status, error = null) {
    store.setState({ syncStatus: status, syncError: error });
  }

  function applyServerWishlist(wishlist) {
    if (!wishlist || !Array.isArray(wishlist.items)) return;
    store.setState({ productIds: wishlist.items.map((item) => String(item.productId)) });
  }

  /**
   * Runs one server mutation, then adopts the server's list. A failed save is
   * reported but not rolled back locally: the item stays on screen, and the
   * next successful read reconciles the truth.
   * @param {() => Promise<{wishlist:object}>} operation
   */
  function pushToServer(operation) {
    if (!serverEnabled()) return Promise.resolve(null);
    return enqueue(async () => {
      setSyncStatus('syncing');
      try {
        const data = await operation();
        applyServerWishlist(data?.wishlist);
        setSyncStatus('ready');
        return data;
      } catch (error) {
        setSyncStatus('error', error);
        return null;
      }
    });
  }

  /**
   * Reads the customer's list from the server and adopts it. Guests skip the
   * round-trip: there is no server list to adopt.
   * @returns {Promise<object|null>}
   */
  function hydrate() {
    if (!serverEnabled()) return Promise.resolve(null);
    return enqueue(async () => {
      setSyncStatus('syncing');
      try {
        const data = await client.get('/wishlist');
        applyServerWishlist(data?.wishlist);
        setSyncStatus('ready');
        return data;
      } catch (error) {
        setSyncStatus('error', error);
        return null;
      }
    });
  }

  /**
   * Folds the shopper's local (guest) list into their customer list. Called
   * right after sign-in; the server skips unknown or archived ids and re-runs
   * are safe, so this can be retried freely.
   * @returns {Promise<object|null>} the merged wishlist view
   */
  function mergeToServer() {
    if (!serverEnabled()) return Promise.resolve(null);
    const ids = store.getState().productIds;
    if (ids.length === 0) return Promise.resolve(null);
    return enqueue(async () => {
      setSyncStatus('syncing');
      try {
        const data = await client.post('/wishlist/merge', { productIds: ids });
        applyServerWishlist(data?.wishlist);
        setSyncStatus('ready');
        return data?.wishlist ?? null;
      } catch (error) {
        setSyncStatus('error', error);
        return null;
      }
    });
  }

  /**
   * @param {string} productId
   * @returns {boolean} true when the product is now saved
   */
  function toggle(productId) {
    const id = normaliseId(productId);
    if (id === null) return false;

    const { productIds } = store.getState();
    const isSaved = productIds.includes(id);

    store.setState({
      productIds: isSaved ? productIds.filter((item) => item !== id) : [id, ...productIds],
    });

    if (serverEnabled()) {
      if (isSaved) {
        void pushToServer(() => client.delete(`/wishlist/items/${encodeURIComponent(id)}`));
      } else {
        void pushToServer(() => client.post('/wishlist/items', { productId: id }));
      }
    }

    return !isSaved;
  }

  /** @param {string} productId */
  function add(productId) {
    const id = normaliseId(productId);
    if (id === null || store.getState().productIds.includes(id)) return false;
    store.setState((prev) => ({ productIds: [id, ...prev.productIds] }));
    if (serverEnabled()) {
      void pushToServer(() => client.post('/wishlist/items', { productId: id }));
    }
    return true;
  }

  /** @param {string} productId */
  function remove(productId) {
    const id = normaliseId(productId);
    if (id === null) return;
    store.setState((prev) => ({ productIds: prev.productIds.filter((item) => item !== id) }));
    if (serverEnabled()) {
      // Deletes are idempotent server-side; removing an already-removed id is
      // a no-op, so this is safe even if the local state drifted.
      void pushToServer(() => client.delete(`/wishlist/items/${encodeURIComponent(id)}`));
    }
  }

  /** @param {string} productId */
  function has(productId) {
    const id = normaliseId(productId);
    return id !== null && store.getState().productIds.includes(id);
  }

  /**
   * Splits a product list into saved and unsaved in one pass, for the wishlist
   * page and for any "saved items" rail.
   * @param {Array<{id:string}>} products
   */
  function partition(products) {
    const saved = new Set(store.getState().productIds);
    return {
      saved: products.filter((product) => saved.has(String(product.id))),
      unsaved: products.filter((product) => !saved.has(String(product.id))),
    };
  }

  /**
   * Reorders a list of products to match wishlist order, for "your saved items".
   * @param {Array<{id:string}>} products
   */
  function sortBySavedOrder(products) {
    const order = new Map(store.getState().productIds.map((id, index) => [id, index]));
    return products
      .filter((product) => order.has(String(product.id)))
      .sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  }

  function clear() {
    const ids = store.getState().productIds;
    store.setState({ productIds: [] });
    if (!serverEnabled() || ids.length === 0) return;
    // There is no bulk-clear endpoint, so each saved id is removed in turn.
    // The queue keeps the deletes ordered; the last one's view wins.
    void pushToServer(async () => {
      let data = null;
      for (const id of ids) {
        data = await client.delete(`/wishlist/items/${encodeURIComponent(id)}`);
      }
      return data;
    });
  }

  const selectIds = store.select(({ productIds }) => productIds);
  const selectCount = store.select(({ productIds }) => productIds.length);
  const selectIsEmpty = store.select(({ productIds }) => productIds.length === 0);
  const selectSyncStatus = store.select(({ syncStatus }) => syncStatus);
  const selectSyncError = store.select(({ syncError }) => syncError);

  /**
   * A per-product boolean selector. Every wishlist button on a page subscribes
   * with one of these, so saving one product repaints one button rather than
   * re-rendering the whole grid.
   * @param {string} productId
   * @returns {() => boolean}
   */
  function selectIsSaved(productId) {
    const id = normaliseId(productId);
    return store.select(({ productIds }) => (id === null ? false : productIds.includes(id)));
  }

  return {
    ...store,
    toggle,
    add,
    remove,
    has,
    partition,
    sortBySavedOrder,
    clear,
    hydrate,
    mergeToServer,
    selectIds,
    selectCount,
    selectIsEmpty,
    selectIsSaved,
    selectSyncStatus,
    selectSyncError,
  };
}

export default { createWishlistStore };
