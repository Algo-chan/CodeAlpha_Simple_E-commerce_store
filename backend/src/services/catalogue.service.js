/**
 * Catalogue service — the seam between HTTP and SQL.
 *
 * WHAT LIVES HERE
 *
 * The controller validates and shapes HTTP. The repository runs SQL. This file
 * decides which queries a request needs and stitches their results into the
 * payload the storefront expects.
 *
 * That split exists because the two awkward decisions in this domain are neither
 * SQL problems nor HTTP problems:
 *
 *   1. `?category=electronics` is a SLUG, but products are filtered by CATEGORY
 *      ID, and the filter has to include every descendant. Resolving that needs a
 *      recursive query plus a 404 decision, which is service work.
 *   2. Facets must be counted with the shopper's own dimension omitted, or
 *      ticking "Nike" collapses every other brand to zero and the panel becomes
 *      useless. That is a decision about what to COUNT, so it belongs where the
 *      counting is planned.
 *
 * Every function here is pure with respect to HTTP: it takes validated input and
 * a database executor, and returns plain objects. That is what makes the service
 * layer testable against PGlite with no server running.
 */
import * as catalogue from '../repositories/catalogue.repository.js';
import * as categories from '../repositories/category.repository.js';
import * as reviews from '../repositories/review.repository.js';
import { toListingProduct, toProductDetail, toReview, editorialFields } from './catalogue.view.js';
import AppError from '../utils/app-error.js';
import { ERROR_CODES } from '../config/constants.js';

/**
 * A catalogue lookup that found nothing.
 *
 * Extends the project's `AppError` rather than `Error` so the centralized handler
 * recognises it as an operational (expected) failure and returns its status and
 * code instead of logging a stack trace and reporting a 500. A missing product is
 * the most common request in the storefront; it must not look like a crash.
 */
export class CatalogueError extends AppError {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string }} [options]
   */
  constructor(message, { status = 404, code = ERROR_CODES.NOT_FOUND } = {}) {
    super(message, status, code);
    this.name = 'CatalogueError';
  }
}

/** 404 for a product slug that matches no ACTIVE row. */
export function productNotFound(slug) {
  return new CatalogueError(`No product matches "${slug}".`, {
    status: 404,
    code: 'PRODUCT_NOT_FOUND',
  });
}

/** 404 for a category slug that matches no ACTIVE row. */
export function categoryNotFound(slug) {
  return new CatalogueError(`No category matches "${slug}".`, {
    status: 404,
    code: 'CATEGORY_NOT_FOUND',
  });
}

/* -------------------------------------------------------------------------- */
/* Filter normalisation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Turns validated query filters into the repository's filter shape.
 *
 * The validator emits `category` (slugs) and the repository wants `categoryIds`.
 * Translating here rather than inside either side keeps the SQL free of slugs and
 * keeps the HTTP layer free of ids.
 *
 * @param {object} query validated query
 * @param {string[]|null} [categoryIds] resolved by the caller
 * @returns {object}
 */
export function toRepositoryFilters(query, categoryIds = null) {
  return {
    categoryIds,
    brands: query.brand ?? [],
    productTypes: query.productType ?? [],
    attributes: query.attributes ?? {},
    minPrice: query.minPrice ?? null,
    maxPrice: query.maxPrice ?? null,
    availability: query.availability ?? null,
  };
}

/**
 * Resolves every `?category=` slug to ids, including descendants.
 *
 * A slug that matches nothing is NOT an error here — it produces an EMPTY ARRAY,
 * which the listing turns into zero results. A shopper who followed a stale category
 * link should see "no products match", not a 404 for a category that may exist
 * under a different name. The category page endpoint is stricter, because there the
 * category IS the resource being requested.
 *
 * The `null` versus `[]` distinction is load-bearing and is the whole reason this
 * function exists separately from the repository:
 *
 *   null  no category filter was asked for      -> the WHERE clause is omitted
 *   []    a category filter matched nothing     -> `= ANY('{}')` matches no row
 *
 * Collapsing them would mean `?category=no-such-category` silently returned the
 * entire catalogue, which is the most dangerous kind of wrong answer this endpoint
 * can give: a broken link would look like a successful browse.
 *
 * Multiple slugs union their subtrees, so `?category=fashion&category=electronics`
 * shows both. A duplicate slug is de-duplicated so its subtree is not scanned twice.
 *
 * @param {string[]|null|undefined} slugs
 * @param {{ query?: Function }} [db]
 * @returns {Promise<string[]|null>} ids, `null` when no slug was given
 */
export async function resolveCategoryIds(slugs, db = {}) {
  if (!Array.isArray(slugs) || slugs.length === 0) return null;

  const unique = [...new Set(slugs)];
  const groups = await Promise.all(unique.map((slug) => categories.listCategoryIds(slug, db)));

  const ids = new Set();
  for (const group of groups) {
    for (const id of group) ids.add(String(id));
  }

  return [...ids];
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Products for a listing, with facets and pagination metadata.
 *
 * Facets run in PARALLEL with the product query rather than after it. They are
 * independent reads, and the panel is worthless until they arrive, so there is no
 * reason to serialise them behind the rows.
 *
 * `includeFacets=false` skips four extra queries, which is what a re-render on
 * filter change wants: the panel counts are already in hand, and recounting them
 * per keystroke is the most expensive thing this endpoint could do.
 *
 * @param {object} query validated query
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object>}
 */
export async function listProducts(query, db = {}) {
  const categoryIds = await resolveCategoryIds(query.categories ?? query.category, db);
  const filters = toRepositoryFilters(query, categoryIds);

  const options = {
    page: query.page,
    limit: query.limit,
    sort: query.sort,
    searchTerm: query.q ?? '',
  };

  const [page, facets] = await Promise.all([
    catalogue.listProducts(filters, options, db),
    query.includeFacets === false ? Promise.resolve(null) : catalogue.buildFacets(filters, db),
  ]);

  const products = page.rows.map(toListingProduct);

  return {
    products,
    pagination: paginate({ total: page.total, page: query.page, limit: query.limit }),
    facets,
    // Echoed back so the frontend can render "in Fashion / Shoes" without a
    // second request, and so a URL and its response are always explainable.
    applied_filters: describeFilters(query, categoryIds),
    sort: query.sort,
    total: page.total,
  };
}

/**
 * Pagination metadata.
 *
 * `has_more` is computed from the total rather than from a full page of results,
 * so the "next" control is correct on the last page too.
 *
 * @param {{ total: number, page: number, limit: number }} input
 * @returns {object}
 */
export function paginate({ total, page, limit }) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  // A page past the end has no rows, so the displayed range is empty rather than
  // inverted. Without this guard `?page=99&limit=3` reports "295-8 of 8", which
  // reads like data corruption rather than an empty page.
  const isBeyondEnd = total > 0 && (page - 1) * limit >= total;

  return {
    page,
    limit,
    total,
    total_pages: totalPages,
    has_more: page < totalPages,
    // Emitted so the UI can offer first/previous/next without comparing numbers.
    has_previous: page > 1 && !isBeyondEnd,
    // 0 when there is nothing to show, so a range is never start > end.
    from: total === 0 || isBeyondEnd ? 0 : (page - 1) * limit + 1,
    to: total === 0 || isBeyondEnd ? 0 : Math.min(page * limit, total),
  };
}

/**
 * The filters actually applied, for display and for debugging a surprising result.
 *
 * Category slugs are echoed rather than ids: a shopper recognises "shoes", and an
 * id in a "showing results for" line would be meaningless to them.
 *
 * @param {object} query
 * @param {string[]|null} categoryIds `null` when no category filter was applied
 * @returns {object}
 */
export function describeFilters(query, categoryIds) {
  return {
    categories: query.categories ?? [],
    category_ids: categoryIds,
    brands: query.brand ?? [],
    product_types: query.productType ?? [],
    attributes: query.attributes ?? {},
    min_price_minor: query.minPrice ?? null,
    max_price_minor: query.maxPrice ?? null,
    availability: query.availability ?? null,
    search: query.q ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Search                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Predictive search for the overlay.
 *
 * Separate from the listing because the shapes differ: the overlay wants a handful
 * of products and up to two matching CATEGORIES, and it needs them fast enough to
 * type against. It reuses the listing query so ranking and filters cannot drift
 * between "type in the box" and "press enter".
 *
 * @param {string} term
 * @param {{ limit?: number }} [options]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<{ products: object[], categories: object[] }>}
 */
export async function searchProducts(term, { limit = 6 } = {}, db = {}) {
  const needle = String(term ?? '').trim();

  if (needle.length === 0) return { products: [], categories: [] };

  // A hard ceiling independent of validation, because this method is also reachable
  // from the overlay on every keystroke and must never pull a large page.
  const cap = Math.min(Math.max(Number(limit) || 6, 1), 12);

  const [page, all] = await Promise.all([
    catalogue.listProducts({}, { page: 1, limit: cap, sort: 'featured', searchTerm: needle }, db),
    categories.listCategories(db),
  ]);

  const matched = page.rows.map(toListingProduct);

  // Category hits come from names, because "shoes" should offer the Shoes category
  // even when the shopper meant the products in it.
  const lower = needle.toLowerCase();
  const categoryHits = all
    .filter((category) => category.name.toLowerCase().includes(lower))
    .slice(0, 2)
    .map((category) => ({
      id: String(category.id),
      name: category.name,
      slug: category.slug,
      product_count: Number(category.product_count ?? 0),
    }));

  return { products: matched, categories: categoryHits };
}

/* -------------------------------------------------------------------------- */
/* Product detail                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One product with everything its page needs.
 *
 * Five queries, fixed regardless of how many variants, images or reviews the
 * product has: product, variants, images, rating summary, first review page. The
 * product and its variants and images could be one round trip, but they are issued
 * together with `Promise.all` and the count does not grow with the data, which is
 * the property that matters — an N+1 would.
 *
 * @param {string} slug
 * @param {{ includeRelated?: boolean }} [options]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object>} the product detail view model
 * @throws {CatalogueError} 404 when no ACTIVE product has that slug
 */
export async function getProduct(slug, { includeRelated = true } = {}, db = {}) {
  const { product, variants, images } = await catalogue.findProductBySlug(slug, db);

  if (!product) throw productNotFound(slug);

  const [rating, reviewPage, flatCategories] = await Promise.all([
    reviews.getRatingSummary(product.id, db),
    reviews.listProductReviews(product.id, { limit: 10, offset: 0 }, db),
    categories.listCategories(db),
  ]);

  // Breadcrumbs come from the one flat category read the navigation already needs.
  const ancestry = categories.buildAncestry(flatCategories, product.category_id);

  let related = [];
  if (includeRelated) {
    related = await listRelatedProducts(product, { limit: 4 }, db);
  }

  return toProductDetail({
    product,
    variants,
    images,
    rating,
    reviews: reviewPage,
    ancestry,
    related,
  });
}

/**
 * Related products for a detail page.
 *
 * Mapped to the same listing view model, so a related card renders through the
 * identical `ProductCard` path as a grid row — no second card component, and no
 * chance of the two drifting apart.
 *
 * @param {object} product row from `findProductBySlug`
 * @param {{ limit?: number }} [options]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object[]>} listing view models
 */
export async function listRelatedProducts(product, { limit = 4 } = {}, db = {}) {
  const [scopeIds, siblings] = await Promise.all([
    categories.listCategoryIds(product.category_slug, db),
    categories.listSiblingCategoryIds(product.category_slug, db),
  ]);

  // An unknown category slug yields no scope, which the repository reads as "no
  // related products". Returning [] is right: without a category there is nothing
  // defensible to rank the rest of the catalogue against.
  if (scopeIds.length === 0) return [];

  const rows = await catalogue.listRelatedProducts(
    {
      categoryIds: scopeIds,
      siblingCategoryIds: siblings,
      brand: product.brand ?? null,
      excludeProductId: String(product.id),
      limit,
    },
    db
  );

  return rows.map(toListingProduct);
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The category tree for navigation and the category grid.
 *
 * `includeEmpty=false` drops categories with nothing in them. It filters BEFORE the
 * tree is built rather than pruning afterwards, which is both simpler and safe:
 * a parent's count is descendant-inclusive, so a parent with a zero count can only
 * have zero-count children, and pruning by hand would risk orphaning them by
 * removing a middle branch whose own children were kept.
 *
 * @param {{ flat?: boolean, includeEmpty?: boolean }} [options]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object[]>} nested nodes, or a flat list when `flat` is set
 */
export async function listCategories({ flat = false, includeEmpty = true } = {}, db = {}) {
  const rows = await categories.listCategories(db);
  const kept = includeEmpty
    ? rows
    : rows.filter((category) => Number(category.product_count ?? 0) > 0);

  return flat ? kept : categories.buildCategoryTree(kept);
}

/**
 * One category and the products beneath it.
 *
 * The product count on the category node is DESCENDANT-INCLUSIVE (so "Electronics"
 * says 3, covering its children) while the listing is scoped to the same subtree,
 * so the header count and the grid agree. `filters.js` also counts inclusively, so
 * there is no case where the badge says 3 and the grid shows 1.
 *
 * @param {string} slug
 * @param {object} query validated listing query
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object>}
 * @throws {CatalogueError} 404 when no ACTIVE category has that slug
 */
export async function getCategoryProducts(slug, query, db = {}) {
  const category = await categories.findCategoryBySlug(slug, db);

  if (!category) throw categoryNotFound(slug);

  const listing = await listProducts(query, db);

  return {
    ...listing,
    category: {
      id: String(category.id),
      name: category.name,
      slug: category.slug,
      description: category.description ?? null,
      image_url: category.image_url ?? null,
      product_count: listing.total,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Approved reviews for a product, paginated.
 *
 * Read-only by design. Creating a review needs an account, and the account phase
 * is out of scope here; exposing a POST now would mean accepting an unverified
 * author.
 *
 * @param {string} slug
 * @param {{ page?: number, limit?: number }} [options]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object>}
 */
export async function getProductReviews(slug, { page = 1, limit = 10 } = {}, db = {}) {
  const { product } = await catalogue.findProductBySlug(slug, db);

  if (!product) throw productNotFound(slug);

  const [page_, rating] = await Promise.all([
    reviews.listProductReviews(
      product.id,
      { limit, offset: (Math.max(Number(page) || 1, 1) - 1) * limit },
      db
    ),
    reviews.getRatingSummary(product.id, db),
  ]);

  return {
    reviews: page_.rows.map(toReview),
    rating,
    pagination: paginate({
      total: page_.total,
      page: Math.max(Number(page) || 1, 1),
      limit,
    }),
  };
}

export default {
  listProducts,
  searchProducts,
  getProduct,
  getProductReviews,
  getCategoryProducts,
  listCategories,
  listRelatedProducts,
  resolveCategoryIds,
  paginate,
  describeFilters,
  toRepositoryFilters,
  editorialFields,
  CatalogueError,
  productNotFound,
  categoryNotFound,
};
