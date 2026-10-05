/**
 * Catalogue state.
 *
 * Holds the normalised product and category lists plus the lookups that the
 * rest of the storefront needs on every interaction: variant by id (the cart
 * reconciles against it), product by slug (deep links), and the facet counts
 * for the filter panel.
 *
 * `productMap` and `variantMap` are rebuilt inside `setCatalogue` rather than
 * derived on read. With a mock catalogue the cost is negligible, and it turns
 * the per-keystroke search path into a Map lookup instead of a linear scan.
 */
import { createStore } from './store.js';
import { humaniseAttribute } from '../utils/product-view.js';

/** @type {Readonly<Record<string, string>>} */
export const LOAD_STATUS = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
});

const initialState = {
  status: LOAD_STATUS.idle,
  error: null,
  /** @type {Array<object>} normalised products, view-model shape */
  products: [],
  /** @type {Array<object>} normalised categories, tree shape */
  categories: [],
  /** Depth-first flat copy of `categories`, parents before children. */
  categoryList: [],
  /**
   * All maps are keyed by String(id). Phase 2 uses UUID primary keys, and
   * `Number(uuid)` is NaN, so normalising to string once here means no caller
   * ever has to remember to.
   * @type {Map<string, object>}
   */
  productMap: new Map(),
  /** @type {Map<string, object>} variant id -> variant */
  variantMap: new Map(),
  /** @type {Map<string, object>} slug -> product */
  slugMap: new Map(),
  /** @type {Map<string, object>} category id -> category */
  categoryMap: new Map(),
  /** Millisecond timestamps of the last load, shown as "prices as of ...". */
  loadedAt: null,
};

export function createCatalogueStore() {
  const store = createStore(initialState, { name: 'catalogue' });

  /**
   * @param {{ products: object[], categories: object[] }} catalogue
   */
  function setCatalogue({ products, categories }) {
    const productMap = new Map(products.map((product) => [String(product.id), product]));
    const slugMap = new Map();
    const variantMap = new Map();

    for (const product of products) {
      slugMap.set(product.slug, product);
      for (const variant of product.variants ?? []) {
        variantMap.set(String(variant.id), variant);
      }
      // A digital product with no variant rows still has a synthetic purchasable
      // one, and the cart stores its id. Left out of the map, `resolveVariant`
      // cannot find it and `reconcile` flags a perfectly good download as
      // "missing" the moment the page is reloaded.
      if (product.default_variant?.synthetic) {
        variantMap.set(String(product.default_variant.id), product.default_variant);
      }
    }

    // Flattened once here. The filter panel and the collection page both need
    // the flat list on every render, and re-walking the tree per render is the
    // kind of cost that shows up as a stutter when six facets are open.
    const categoryList = flattenCategories(categories);
    const categoryMap = new Map(categoryList.map((category) => [String(category.id), category]));

    store.setState({
      status: LOAD_STATUS.ready,
      error: null,
      products,
      categories,
      categoryList,
      productMap,
      slugMap,
      variantMap,
      categoryMap,
      loadedAt: Date.now(),
    });
  }

  function setLoading() {
    store.setState({ status: LOAD_STATUS.loading, error: null });
  }

  /** @param {unknown} error */
  function setError(error) {
    store.setState({ status: LOAD_STATUS.error, error });
  }

  /* --- Lookups -------------------------------------------------------------- */

  /** @param {string} id */
  function getProduct(id) {
    if (id === null || id === undefined) return null;
    return store.getState().productMap.get(String(id)) ?? null;
  }

  /** @param {string} slug */
  function getProductBySlug(slug) {
    return store.getState().slugMap.get(String(slug)) ?? null;
  }

  /** @param {string} id */
  function getVariant(id) {
    if (id === null || id === undefined) return null;
    return store.getState().variantMap.get(String(id)) ?? null;
  }

  /** @param {string} id */
  function getCategory(id) {
    if (id === null || id === undefined) return null;
    return store.getState().categoryMap.get(String(id)) ?? null;
  }

  /** @returns {object[]} categories in display order, flattened */
  function getAllCategories() {
    return Array.from(store.getState().categoryMap.values());
  }

  /**
   * Products in a category, including anything in its descendants.
   * A shopper who opens "Home & Living" expects the kettle on the "Kitchen"
   * shelf to be there, not hidden one level down.
   * @param {string} categoryId
   */
  function getProductsInCategory(categoryId) {
    const ids = new Set([String(categoryId)]);
    let added = true;

    while (added) {
      added = false;
      for (const category of getAllCategories()) {
        const id = String(category.id);
        const parentId = category.parent_id === null ? null : String(category.parent_id);
        if (ids.has(id) || !parentId || !ids.has(parentId)) continue;
        ids.add(id);
        added = true;
      }
    }

    return store
      .getState()
      .products.filter((product) => product.is_listable && ids.has(String(product.category_id)));
  }

  /**
   * The chain from a category up to its root, for breadcrumbs.
   * @param {string} categoryId
   * @returns {object[]}
   */
  function getCategoryTrail(categoryId) {
    const trail = [];
    let current = getCategory(categoryId);
    const guard = new Set();

    while (current && !guard.has(String(current.id))) {
      guard.add(String(current.id));
      trail.unshift(current);
      current = current.parent_id ? getCategory(current.parent_id) : null;
    }
    return trail;
  }

  /* --- Selectors ------------------------------------------------------------ */

  const selectProducts = store.select(({ products }) => products);

  /**
   * Everything the storefront is allowed to show a shopper.
   *
   * The store deliberately keeps unpublished products - that is what the DRAFT
   * row in the mock is for - so every grid, facet count and category tile routes
   * through here. A DRAFT must never be reachable from the storefront, however
   * attractive it otherwise looks.
   */
  const selectListable = store.select(({ products }) => products.filter((p) => p.is_listable));

  const selectFeatured = store.select(({ products }) =>
    products.filter((product) => product.is_listable && product.is_featured)
  );
  const selectOnSale = store.select(({ products }) =>
    products.filter((product) => product.is_listable && product.is_on_sale)
  );

  /**
   * New arrivals is an editorial flag, not a date sort. `created_at` only
   * decides the order *within* the flagged set: ranking purely by date promoted
   * whichever row happened to be added last, which is not the same claim.
   */
  const selectNewArrivals = store.select(({ products }) =>
    products
      .filter((product) => product.is_listable && product.is_new)
      .sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at))
  );

  /**
   * Merchandised ranking for the homepage popular row, driven by the hand-set
   * `display_order` on each mock product.
   *
   * This is an editorial selection, not a sales ranking - there is no order
   * history behind it yet - so the section heading says as much. Products with
   * no rank set (0) drop out rather than sort to the top.
   */
  const selectPopular = store.select(({ products }) =>
    products
      .filter((product) => product.is_listable && product.display_order > 0)
      .sort((a, b) => a.display_order - b.display_order || String(a.id).localeCompare(String(b.id)))
  );

  /** Products sharing at least one category with the given product. */
  const selectRelated = store.select(({ products }) => (product) => {
    if (!product) return [];
    const categoryIds = new Set([
      String(product.category_id),
      ...(product.categories ?? []).map((category) => String(category.id ?? category)),
    ]);

    return products
      .filter(
        (candidate) =>
          candidate.is_listable &&
          String(candidate.id) !== String(product.id) &&
          categoryIds.has(String(candidate.category_id))
      )
      .sort(
        (a, b) =>
          Number(b.is_featured) - Number(a.is_featured) || String(a.id).localeCompare(String(b.id))
      )
      .slice(0, 8);
  });

  /**
   * Facet counts for the filter panel: every attribute value in the current
   * result set, with how many products carry it.
   *
   * Counted over LISTABLE products only, and deliberately not over the other
   * active facets: a shopper needs to see what selecting another value would
   * add, not what the current selection already removed.
   *
   * The listable filter is not cosmetic here. A DRAFT row also carries
   * attributes, and counting it would make the panel advertise a value - say
   * "Black (7)" - that only six reachable products actually have, so following
   * the count would return fewer results than it promised, sourced from a
   * product nobody is allowed to see. `computeFacets` in the mock client
   * applies the same rule, so the two agree.
   */
  const selectFacets = store.select(({ products }) => {
    const attributes = new Map();
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const product of products) {
      if (!product.is_listable) continue;

      if (product.price_min_minor != null) {
        minPrice = Math.min(minPrice, product.price_min_minor);
        maxPrice = Math.max(maxPrice, product.price_max_minor ?? product.price_min_minor);
      }
      for (const [key, values] of Object.entries(product.attributes ?? {})) {
        if (!attributes.has(key)) attributes.set(key, new Map());
        const counts = attributes.get(key);
        for (const value of values) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
    }

    return {
      price: {
        min: Number.isFinite(minPrice) ? minPrice : 0,
        max: Number.isFinite(maxPrice) ? maxPrice : 0,
      },
      attributes: Array.from(attributes, ([key, counts]) => ({
        key,
        label: humaniseAttribute(key),
        values: Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) =>
          a.value.localeCompare(b.value)
        ),
      })),
    };
  });

  return {
    ...store,
    setCatalogue,
    setLoading,
    setError,
    getProduct,
    getProductBySlug,
    getVariant,
    getCategory,
    getAllCategories,
    getProductsInCategory,
    getCategoryTrail,
    selectProducts,
    selectListable,
    selectFeatured,
    selectOnSale,
    selectNewArrivals,
    selectPopular,
    selectRelated,
    selectFacets,
    /** Depth-first flat copy of `categories`, parents before children. */
    selectCategories: store.select(({ categoryList }) => categoryList),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Depth-first flatten of the category tree.
 * @param {Array<{id:number, children?:object[]}>} categories
 * @returns {object[]}
 */
export function flattenCategories(categories, depth = 0) {
  const flat = [];
  for (const category of categories ?? []) {
    flat.push({ ...category, depth });
    if (category.children?.length) {
      flat.push(...flattenCategories(category.children, depth + 1));
    }
  }
  return flat;
}

/* `humaniseAttribute` used to be defined here and duplicated in `mock/view.js` and
 * `mock/api.js`, each spelling the rule differently. It lives in
 * `utils/product-view.js` now, re-exported below so existing importers and tests
 * keep working. */

function dateValue(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export { humaniseAttribute };

export default { createCatalogueStore, flattenCategories, humaniseAttribute, LOAD_STATUS };
