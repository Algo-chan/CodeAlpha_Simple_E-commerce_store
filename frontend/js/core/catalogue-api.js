/**
 * Catalogue client — the real-API counterpart of `js/mock/api.js`.
 *
 * WHAT IT REPLACES
 *
 * `js/mock/api.js` answers from in-browser fixtures so the storefront can be
 * built and reviewed with no backend. This module makes the same calls against
 * `/api/v1`, so `app.js` can pick one or the other without a single component
 * changing: both expose `getCatalogue`, `getProduct` and `searchProducts`, and
 * both resolve to the SAME product view model, because the API maps its rows to
 * that shape (see `backend/src/services/catalogue.view.js`).
 *
 * WHY `getCatalogue` IS ONE REQUEST
 *
 * The storefront shell holds the whole catalogue in memory — every grid, rail,
 * filter and the variant lookup behind "add to cart" reads from it — so the API
 * exposes `GET /catalogue`, which returns every ACTIVE product as a DETAIL view
 * model plus the category tree. That is not `GET /products` with a large limit:
 * a listing row deliberately omits the variant matrix and the full gallery.
 *
 * `getFacets` is deliberately absent. The mock offered it, but the collection
 * page counts facets from the in-memory catalogue (`computeFacets`), so nothing
 * calls it, and the real API scopes facets to a listing rather than exposing one
 * catalogue-wide shape.
 */
import { api } from './api.js';

export const catalogueApi = {
  /**
   * The shell payload: every listable product as a detail model, plus the tree.
   *
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ products: object[], categories: object[] }>}
   */
  async getCatalogue({ signal } = {}) {
    const data = await api.get('/catalogue', { signal });

    return {
      products: data?.products ?? [],
      categories: data?.categories ?? [],
    };
  },

  /**
   * One product by slug (or id, which the endpoint resolves as a slug miss).
   *
   * @param {string} slugOrId
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<object|null>}
   */
  async getProduct(slugOrId, { signal } = {}) {
    const data = await api.get(`/products/${encodeURIComponent(slugOrId)}`, { signal });

    return data?.product ?? null;
  },

  /**
   * Predictive search for the overlay. An empty term is not a request: it
   * resolves to nothing without touching the network, because `/search/suggest`
   * rejects an empty `q` with a 422 by design.
   *
   * @param {string} query
   * @param {{ limit?: number, signal?: AbortSignal }} [params]
   * @returns {Promise<{ products: object[], categories: object[] }>}
   */
  async searchProducts(query, { limit = 6, signal } = {}) {
    const needle = String(query ?? '').trim();
    if (needle.length === 0) return { products: [], categories: [] };

    const data = await api.get('/search/suggest', { query: { q: needle, limit }, signal });

    return {
      products: data?.products ?? [],
      categories: data?.categories ?? [],
    };
  },
};

export default catalogueApi;
