/**
 * Mock catalogue service.
 *
 * The seam between the storefront and the future API. It exposes the same
 * method names, the same `{ data }` unwrapping and the same `ApiError` as
 * `core/api.js`, so swapping in the real client is a change to one import in
 * `app.js` and nothing else.
 *
 * LATENCY IS THE POINT. Without it the storefront renders instantly, and an
 * instant render means the loading, skeleton and empty states are never
 * exercised - they are the states that break first in production. A small,
 * jittered delay keeps them honest.
 *
 * FAILURE INJECTION IS ALSO THE POINT. `?fail=catalogue` in the URL, or
 * `localStorage['aie:mock:fail']`, forces the failure path so the error state
 * can be seen and tested on demand.
 */
import { ApiError } from '../core/api.js';
import { config } from '../config.js';
import { listCategories, buildTree } from './categories.js';
import { listProducts, listVariants, listReviews } from './products.js';
import { buildCatalogue, LISTABLE_STATUS } from './view.js';

const FAILURE_FLAG_KEY = 'aie:mock:fail';

/** What each `?fail=` value does. */
const FAILURE_MODES = Object.freeze({
  catalogue: 'catalogue',
  product: 'product',
  search: 'search',
  slow: 'slow',
  offline: 'offline',
});

/* -------------------------------------------------------------------------- */
/* Fixture access                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Builds the normalised catalogue.
 *
 * In production this becomes two requests (`GET /products`, `GET /categories`).
 * Here it is one synchronous pass over fixtures, then cached - so a filter
 * change costs nothing.
 *
 * @returns {{ products: object[], categories: object[] }}
 */
export function fixtureCatalogue() {
  return buildCatalogue({
    products: listProducts(),
    categories: listCategories(),
    variants: listVariants(),
    reviews: listReviews(),
    categoryTree: buildTree(listCategories()),
  });
}

/* -------------------------------------------------------------------------- */
/* Mock client                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {{ latencyMs?: number, jitterMs?: number,
 *           shouldFail?: (method: string) => string|null }} [options]
 */
export function createMockClient(options = {}) {
  const latencyMs = options.latencyMs ?? config.mockLatencyMs;
  const jitterMs = options.jitterMs ?? config.mockJitterMs;
  const shouldFail = options.shouldFail ?? detectFailure;

  /** @type {{ products: object[], categories: object[] } | null} */
  let cache = null;

  function load() {
    if (!cache) cache = fixtureCatalogue();
    return cache;
  }

  /**
   * @param {string} method
   * @param {AbortSignal} [signal]
   */
  async function simulate(method, signal) {
    const mode = shouldFail();
    if (mode) throw failureFor(mode, method);

    const delay = latencyMs + Math.round((Math.random() - 0.5) * 2 * jitterMs);
    if (delay <= 0) return;

    await wait(delay, signal);
  }

  return {
    /** Invalidates the fixture cache. */
    invalidate() {
      cache = null;
    },

    /**
     * Products and categories in one call. A real client would split this, but
     * the storefront needs both to render the shell, so they ship together.
     * @returns {Promise<{ products: object[], categories: object[] }>}
     */
    async getCatalogue({ signal } = {}) {
      await simulate('catalogue', signal);
      return structuredClone(load());
    },

    /**
     * @param {string} slugOrId
     * @returns {Promise<object>} the product view model
     * @throws {ApiError} 404-shaped when nothing matches
     */
    async getProduct(slugOrId, { signal } = {}) {
      await simulate('product', signal);

      const { products } = load();
      const key = String(slugOrId);
      const product = products.find((item) => item.slug === key || item.id === key);

      if (!product) {
        throw new ApiError(`No product matches "${slugOrId}".`, {
          status: 404,
          code: 'PRODUCT_NOT_FOUND',
        });
      }
      return structuredClone(product);
    },

    /**
     * Predictive search.
     *
     * Ranked by match position and field weight rather than alphabetically:
     * a name match outranks a description match, and a prefix match outranks a
     * match in the middle of the word.
     *
     * @param {string} query
     * @param {{ limit?: number }} [params]
     * @returns {Promise<{ products: object[], categories: object[] }>}
     */
    async searchProducts(query, { limit = 6, signal } = {}) {
      await simulate('search', signal);

      const needle = String(query ?? '')
        .trim()
        .toLowerCase();
      if (needle.length === 0) return { products: [], categories: [] };

      const { products, categories } = load();

      const categoryHits = categories
        .filter((category) => category.name.toLowerCase().includes(needle))
        .slice(0, 2);

      const scored = products
        .filter((product) => product.is_listable)
        .map((product) => ({ product, score: scoreProduct(product, needle) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return {
        products: scored.map((entry) => structuredClone(entry.product)),
        categories: categoryHits,
      };
    },

    /**
     * Facet data for the filter panel.
     * @returns {Promise<{ price:{min:number,max:number}, attributes:object[] }>}
     */
    async getFacets({ signal } = {}) {
      await simulate('catalogue', signal);
      return structuredClone(computeFacets(load().products));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Facet ranges and counts, computed over every listable product. Untracked
 * attributes are skipped, and each value carries its own product count so the
 * panel can show "Black (6)".
 */
export function computeFacets(products) {
  const listable = products.filter((product) => product.status === LISTABLE_STATUS);
  const attributeCounts = new Map();

  let min = Infinity;
  let max = -Infinity;

  for (const product of listable) {
    for (const candidate of [product.price_min_minor, product.price_max_minor]) {
      if (candidate === null) continue;
      min = Math.min(min, candidate);
      max = Math.max(max, candidate);
    }

    for (const [key, values] of Object.entries(product.attributes ?? {})) {
      if (!attributeCounts.has(key)) {
        attributeCounts.set(key, { key, label: humanise(key), counts: new Map() });
      }
      const bucket = attributeCounts.get(key);
      for (const value of values) {
        bucket.counts.set(value, (bucket.counts.get(value) ?? 0) + 1);
      }
    }
  }

  return {
    price: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 },
    attributes: Array.from(attributeCounts.values(), ({ key, label, counts }) => ({
      key,
      label,
      values: Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) =>
        a.value.localeCompare(b.value)
      ),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Search scoring                                                               */
/* -------------------------------------------------------------------------- */

/** Higher is better. Weights reflect how likely the field is to be what the shopper typed. */
const FIELD_WEIGHTS = { name: 12, brand: 8, sku: 6, category: 5, tags: 4, description: 2 };

function scoreProduct(product, needle) {
  let score = 0;

  const name = product.name.toLowerCase();
  if (name.startsWith(needle)) score += FIELD_WEIGHTS.name * 2;
  else if (name.includes(needle)) score += FIELD_WEIGHTS.name;

  if (product.brand?.toLowerCase().includes(needle)) score += FIELD_WEIGHTS.brand;
  if ((product.category_name ?? '').toLowerCase().includes(needle)) score += FIELD_WEIGHTS.category;
  if (product.variants?.some((variant) => variant.sku?.toLowerCase().includes(needle))) {
    score += FIELD_WEIGHTS.sku;
  }
  for (const tag of product.tags ?? []) {
    if (tag.toLowerCase().includes(needle)) score += FIELD_WEIGHTS.tags;
  }
  if (product.description?.toLowerCase().includes(needle)) score += FIELD_WEIGHTS.description;

  // Every word must appear somewhere, so "max black" does not return every
  // black product on the strength of "max" alone.
  const haystack = [
    name,
    product.brand ?? '',
    product.category_name ?? '',
    product.description ?? '',
    ...(product.tags ?? []),
    ...(product.variants ?? []).map((variant) =>
      variant.attributes ? Object.values(variant.attributes).join(' ') : ''
    ),
  ]
    .join(' ')
    .toLowerCase();

  const allWordsMatch = needle.split(/\s+/).every((word) => haystack.includes(word));
  return allWordsMatch ? score : 0;
}

/* -------------------------------------------------------------------------- */
/* Failure injection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decides whether this call should fail.
 * Resolution order: explicit URL flag, then localStorage flag.
 *
 * The flag is deliberately not scoped to a single method. A shopper who
 * reproduces "the site is down" with `?fail=catalogue` wants the catalogue to
 * fail and the page to show its error state - not a coin flip about which
 * request happened to be in flight.
 *
 * @returns {string|null} failure mode, or null
 */
function detectFailure() {
  const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('fail');
  if (fromUrl && fromUrl in FAILURE_MODES) return fromUrl;

  try {
    const stored = globalThis.localStorage?.getItem(FAILURE_FLAG_KEY);
    if (stored && stored in FAILURE_MODES) return stored;
  } catch {
    /* storage unavailable; nothing to inject */
  }

  return null;
}

function failureFor(mode, method) {
  if (mode === 'offline') {
    return new ApiError(`Cannot reach the API at ${config.apiBaseUrl}. Is the backend running?`, {
      code: 'NETWORK_ERROR',
    });
  }
  return new ApiError(`Mock failure injected for "${method}".`, {
    status: 500,
    code: 'MOCK_FAILURE',
  });
}

/** Turns a failure on or off for a reload, e.g. `aie.setMockFailure('catalogue')`. */
export function setMockFailure(mode) {
  try {
    if (mode && mode in FAILURE_MODES) {
      globalThis.localStorage?.setItem(FAILURE_FLAG_KEY, mode);
    } else {
      globalThis.localStorage?.removeItem(FAILURE_FLAG_KEY);
    }
  } catch {
    /* storage unavailable; failure injection is best-effort */
  }
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                    */
/* -------------------------------------------------------------------------- */

/** Abortable delay. Rejects with an AbortError if the signal fires first. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function humanise(key) {
  const spaced = String(key).replace(/[_-]/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The instance the app uses. */
export const mockApi = createMockClient();

export default mockApi;
