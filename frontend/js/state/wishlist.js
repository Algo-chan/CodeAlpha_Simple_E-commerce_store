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

/** @returns {ReturnType<typeof createStore> & {...}} */
export function createWishlistStore() {
  const store = createStore(initialState, {
    name: 'wishlist',
    persist: { key: 'wishlist', version: WISHLIST_STORAGE_VERSION },
  });

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
      productIds: isSaved
        ? productIds.filter((item) => item !== id)
        : [id, ...productIds],
    });

    return !isSaved;
  }

  /** @param {string} productId */
  function add(productId) {
    const id = normaliseId(productId);
    if (id === null || store.getState().productIds.includes(id)) return false;
    store.setState((prev) => ({ productIds: [id, ...prev.productIds] }));
    return true;
  }

  /** @param {string} productId */
  function remove(productId) {
    const id = normaliseId(productId);
    if (id === null) return;
    store.setState((prev) => ({ productIds: prev.productIds.filter((item) => item !== id) }));
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
    store.setState({ productIds: [] });
  }

  const selectIds = store.select(({ productIds }) => productIds);
  const selectCount = store.select(({ productIds }) => productIds.length);
  const selectIsEmpty = store.select(({ productIds }) => productIds.length === 0);

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
    selectIds,
    selectCount,
    selectIsEmpty,
    selectIsSaved,
  };
}

export default { createWishlistStore };