/**
 * Collection filter and sort state.
 *
 * Everything here is pure: `filterProducts` and `sortProducts` take a product
 * list and a filter object and return a new list. Keeping them free of the
 * store means the same functions can be unit tested, and means changing a
 * filter can never leave the grid and the result count disagreeing.
 *
 * PRICE HANDLING. Bounds are stored in ETB minor units, matching the database
 * and the cart. The price inputs are the only place the shopper ever sees major
 * units, and they convert at the input boundary via `majorToMinor`.
 */
import { createStore } from './store.js';
import { majorToMinor } from '../utils/format.js';

/**
 * Bumped to 2 when ids became UUIDs. Anything saved under version 1 referenced
 * numeric ids that can never match again, and a version bump discards it cleanly
 * rather than leaving entries that silently do nothing.
 */
export const FILTERS_STORAGE_VERSION = 2;

/**
 * The shape a product must have to be filterable. `view.js` builds exactly
 * this, but any object with these fields works.
 *
 * Note the field name: view-model products carry `is_listable`, NOT `is_active`.
 * `is_active` belongs to categories and to individual variants - a product's
 * own publication state is `status`. Keeping the two apart matters, because a
 * guard written against the wrong one silently never fires.
 *
 * @typedef {object} FilterableProduct
 * @property {string} id
 * @property {string} category_id
 * @property {boolean} is_listable
 * @property {boolean} is_featured
 * @property {string} created_at
 * @property {number|null} price_min_minor  cheapest active variant
 * @property {number|null} price_max_minor  dearest active variant
 * @property {boolean} is_on_sale           any variant priced below its compare-at
 * @property {boolean} in_stock             any active variant with stock, or untracked
 * @property {number|null} rating_average
 * @property {number} rating_count
 * @property {Record<string, string[]>} attributes  merged across variants
 */

/** @type {Readonly<Record<string, {label:string, compare:(a:FilterableProduct,b:FilterableProduct)=>number}>>} */
export const SORT_OPTIONS = Object.freeze({
  featured: {
    label: 'Featured',
    // Featured first, then a stable tiebreak. Product ids are UUIDs, so
    // subtraction is meaningless here; string order is stable and deterministic.
    compare: (a, b) =>
      Number(b.is_featured) - Number(a.is_featured) || String(a.id).localeCompare(String(b.id)),
  },
  newest: { label: 'Newest', compare: (a, b) => dateValue(b.created_at) - dateValue(a.created_at) },
  'price-asc': {
    label: 'Price: low to high',
    compare: (a, b) => (a.price_min_minor ?? Infinity) - (b.price_min_minor ?? Infinity),
  },
  'price-desc': {
    label: 'Price: high to low',
    compare: (a, b) => (b.price_min_minor ?? -Infinity) - (a.price_min_minor ?? Infinity),
  },
  'name-asc': {
    label: 'Name: A to Z',
    compare: (a, b) => String(a.name).localeCompare(String(b.name)),
  },
  'name-desc': {
    label: 'Name: Z to A',
    compare: (a, b) => String(b.name).localeCompare(String(a.name)),
  },
  rating: {
    label: 'Top rated',
    compare: (a, b) =>
      (b.rating_average ?? 0) - (a.rating_average ?? 0) ||
      (b.rating_count ?? 0) - (a.rating_count ?? 0),
  },
  discount: {
    label: 'Biggest saving',
    compare: (a, b) => discountRatio(b) - discountRatio(a),
  },
});

const initialState = {
  search: '',
  categoryId: null,
  /** @type {string[]} attribute key -> selected values */
  attributes: {},
  /** @type {{min:number|null, max:number|null}} minor units */
  price: { min: null, max: null },
  inStockOnly: false,
  onSaleOnly: false,
  sort: 'featured',
  view: 'grid',
  page: 1,
  perPage: 12,
};

export function createFilterStore() {
  const store = createStore(initialState, {
    name: 'filters',
    persist: {
      key: 'filters',
      version: FILTERS_STORAGE_VERSION,
      // Sorting, paging and the grid/list choice are session preferences, not
      // shopping intent. Persisting them would resurrect a page-7 scroll on the
      // next visit, so only the meaningful facets survive a reload.
      select: ({ search, categoryId, attributes, price, inStockOnly, onSaleOnly }) => ({
        search,
        categoryId,
        attributes,
        price,
        inStockOnly,
        onSaleOnly,
      }),
    },
  });

  /** Any filter that narrows the set, ignoring sort/view/page. */
  const selectIsFiltered = store.select((state) => countActiveFilters(state) > 0);

  const selectActiveChips = store.select((state) => buildChips(state));

  return {
    ...store,
    selectIsFiltered,
    selectActiveChips,
    patch(partial) {
      // Any facet change invalidates the current page: staying on page 7 and
      // then removing a filter would show an empty grid.
      store.setState({ ...partial, page: partial.page ?? 1 });
    },
    setSearch(search) {
      store.setState({ search: String(search ?? '').trim(), page: 1 });
    },
    setCategory(categoryId) {
      store.setState({
        categoryId: categoryId === null || categoryId === '' ? null : String(categoryId),
        page: 1,
      });
    },
    toggleAttribute(key, value) {
      store.setState((prev) => {
        const current = new Set(prev.attributes[key] ?? []);
        if (current.has(value)) current.delete(value);
        else current.add(value);
        return {
          attributes: { ...prev.attributes, [key]: Array.from(current) },
          page: 1,
        };
      });
    },
    /** Sets price bounds from whole-birr values as typed by the shopper. */
    setPriceRange({ min, max } = {}) {
      store.setState({
        price: {
          min: min === '' || min === null || min === undefined ? null : majorToMinor(min),
          max: max === '' || max === null || max === undefined ? null : majorToMinor(max),
        },
        page: 1,
      });
    },
    toggleInStockOnly() {
      store.setState((prev) => ({ inStockOnly: !prev.inStockOnly, page: 1 }));
    },
    toggleOnSaleOnly() {
      store.setState((prev) => ({ onSaleOnly: !prev.onSaleOnly, page: 1 }));
    },
    setSort(sort) {
      store.setState({ sort: sort in SORT_OPTIONS ? sort : 'featured', page: 1 });
    },
    setView(view) {
      store.setState({ view: view === 'list' ? 'list' : 'grid' });
    },
    setPage(page) {
      store.setState({ page: Math.max(1, Number(page) || 1) });
    },
    resetFacets() {
      store.setState({
        search: '',
        /** @type {string|null} UUID, never a number */
        categoryId: null,
        attributes: {},
        price: { min: null, max: null },
        inStockOnly: false,
        onSaleOnly: false,
        page: 1,
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Pure query functions                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Applies every facet. Products must already be normalised by the mock layer.
 *
 * @param {FilterableProduct[]} products
 * @param {object} filters
 * @param {{ categoryIds?: Set<string>|null }} [options] the selected category and
 *        its descendants, precomputed by the caller
 * @returns {FilterableProduct[]}
 */
export function filterProducts(products, filters, { categoryIds = null } = {}) {
  const needle = (filters.search ?? '').toLowerCase().trim();

  return products.filter((product) => {
    // `is_listable`, tested strictly. A raw database row has no such field, so
    // `!== true` rejects that too: filtering expects the view model, and quietly
    // accepting unnormalised rows is how a DRAFT ends up in a grid. The
    // collection page also pre-selects `selectListable()`, but this function is
    // exported, so it cannot depend on its caller having done that.
    if (product.is_listable !== true) return false;

    // A category filter matches the category and everything beneath it. Clicking
    // "Home & Living" and getting an empty grid because its products sit in
    // "Lighting" is the most common way a faceted storefront feels broken.
    if (filters.categoryId && !categoryMatches(product, filters.categoryId, categoryIds)) {
      return false;
    }

    if (needle && !matchesSearch(product, needle)) return false;

    if (filters.inStockOnly && !product.in_stock) return false;
    if (filters.onSaleOnly && !product.is_on_sale) return false;

    const { min, max } = filters.price ?? {};
    if (min !== null && min !== undefined) {
      // Compare against the dearest variant too, so a product that spans the
      // boundary still shows - shoppers expect "under 500" to include a
      // 400-900 product, and the price range then reads 400-900 on the card.
      if ((product.price_max_minor ?? product.price_min_minor ?? 0) < min) return false;
    }
    if (max !== null && max !== undefined) {
      if ((product.price_min_minor ?? Infinity) > max) return false;
    }

    return matchesAttributes(product, filters.attributes);
  });
}

/**
 * True when the product sits in the selected category or any descendant of it.
 *
 * `categoryIds` is passed in precomputed from the category tree, because walking
 * the tree for every product on every render would be O(products x categories)
 * each time a price input fires. Falls back to an exact id match when the set is
 * absent, so a caller that only knows one category still gets correct results.
 */
function categoryMatches(product, categoryId, categoryIds) {
  if (categoryIds && categoryIds.size > 0) return categoryIds.has(String(product.category_id));
  return String(product.category_id) === String(categoryId);
}

/**
 * Attribute facets are OR within a key and AND across keys: "Black or Navy"
 * AND "Medium or Large" is what a shopper means.
 */
function matchesAttributes(product, selected) {
  if (!selected || Object.keys(selected).length === 0) return true;

  return Object.entries(selected).every(([key, values]) => {
    if (!values || values.length === 0) return true;
    const available = product.attributes?.[key];
    if (!available) return false;
    return values.some((value) => available.includes(value));
  });
}

function matchesSearch(product, needle) {
  const haystack = [
    product.name,
    product.short_description,
    product.sku,
    ...(product.categories ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * @param {FilterableProduct[]} products
 * @param {string} sort
 * @returns {FilterableProduct[]} a new, sorted array
 */
export function sortProducts(products, sort) {
  const option = SORT_OPTIONS[sort] ?? SORT_OPTIONS.featured;
  return [...products].sort(option.compare);
}

/**
 * Filters, sorts and paginates in one pass. This is what the collection page
 * calls, so the grid and the result count can never disagree.
 *
 * @param {FilterableProduct[]} products
 * @param {object} filters
 * @param {{ categoryIds?: Set<string>|null }} [options]
 * @returns {{ items: FilterableProduct[], total: number, totalPages: number,
 *             page: number, from: number, to: number }}
 */
export function queryProducts(products, filters, options = {}) {
  const filtered = filterProducts(products, filters, options);
  const sorted = sortProducts(filtered, filters.sort);

  const perPage = Math.max(1, Number(filters.perPage) || 12);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, Number(filters.page) || 1), totalPages);

  const from = (page - 1) * perPage;
  const items = sorted.slice(from, from + perPage);

  return { items, total, totalPages, page, from, to: from + items.length };
}

/* -------------------------------------------------------------------------- */
/* Chip helpers                                                                 */
/* -------------------------------------------------------------------------- */

/** How many facets are narrowing the result set. */
export function countActiveFilters(filters) {
  let count = 0;
  if (filters.search) count += 1;
  if (filters.categoryId) count += 1;
  if (filters.inStockOnly) count += 1;
  if (filters.onSaleOnly) count += 1;
  if (filters.price?.min !== null && filters.price?.min !== undefined) count += 1;
  if (filters.price?.max !== null && filters.price?.max !== undefined) count += 1;
  for (const values of Object.values(filters.attributes ?? {})) {
    count += Array.isArray(values) ? values.length : 0;
  }
  return count;
}

/**
 * Chips for the "you filtered by" row. Each chip knows how to remove itself,
 * which is why `key` and `value` are carried through to the click handler.
 *
 * @param {object} filters
 * @param {(chip:{type:string, key:string, value?:any, label:string}) => void} [_onRemove]
 */
export function buildChips(filters) {
  const chips = [];

  if (filters.search) {
    chips.push({ type: 'search', key: 'search', label: `“${filters.search}”` });
  }

  for (const [key, values] of Object.entries(filters.attributes ?? {})) {
    for (const value of values ?? []) {
      chips.push({ type: 'attribute', key, value, label: value });
    }
  }

  if (filters.price?.min != null && filters.price?.max != null) {
    chips.push({
      type: 'price',
      key: 'price',
      label: 'Price range',
    });
  } else if (filters.price?.min != null) {
    chips.push({ type: 'price', key: 'price', value: 'min', label: 'Price' });
  } else if (filters.price?.max != null) {
    chips.push({ type: 'price', key: 'price', value: 'max', label: 'Price' });
  }

  if (filters.inStockOnly) {
    chips.push({ type: 'inStock', key: 'inStockOnly', label: 'In stock only' });
  }
  if (filters.onSaleOnly) {
    chips.push({ type: 'onSale', key: 'onSaleOnly', label: 'On sale' });
  }

  return chips;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

function dateValue(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function discountRatio(product) {
  const { price_min_minor: price, price_max_minor: max } = product;
  if (!price || !max || max <= price) return 0;
  return (max - price) / max;
}

export default {
  createFilterStore,
  filterProducts,
  sortProducts,
  queryProducts,
  countActiveFilters,
  buildChips,
  SORT_OPTIONS,
};
