/**
 * Catalogue controller — HTTP in, HTTP out.
 *
 * Deliberately thin. A controller's only jobs are: read the already-validated
 * request, call the service, and translate the outcome into a status code and an
 * envelope. Any `if` in here that makes a product decision belongs in the service.
 *
 * Envelope handling is NOT done here either. `httpResponse.success` and the
 * central error handler already agree on shape, so repeating it per route would
 * create a second place to get wrong.
 */
import { asyncHandler } from '../utils/async-handler.js';
import * as service from '../services/catalogue.service.js';
import * as catalogue from '../repositories/catalogue.repository.js';

/**
 * `GET /api/v1/products`
 *
 * Query parameters have already been through `listProductsQuerySchema`, so the
 * handler receives coerced numbers, an enum-checked sort key and a bounded
 * attribute map. It still treats everything as untrusted, because validation is a
 * separate layer that can be reordered or removed by a later edit.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const listProducts = asyncHandler(async (req, res) => {
  const payload = await service.listProducts(req.validatedQuery, req.db);

  res.json({ success: true, data: payload });
});

/**
 * `GET /api/v1/categories`
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const listCategories = asyncHandler(async (req, res) => {
  const { flat, includeEmpty } = req.validatedQuery;
  const categories = await service.listCategories({ flat, includeEmpty }, req.db);

  res.json({ success: true, data: { categories } });
});

/**
 * `GET /api/v1/categories/:slug`
 *
 * The category plus a paged, filtered listing of everything beneath it, so the
 * page renders from one response rather than racing two.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getCategory = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const payload = await service.getCategoryProducts(slug, req.validatedQuery, req.db);

  res.json({ success: true, data: payload });
});

/**
 * `GET /api/v1/products/:slug`
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getProduct = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { includeRelated } = req.validatedQuery;

  const product = await service.getProduct(slug, { includeRelated }, req.db);

  res.json({ success: true, data: { product } });
});

/**
 * `GET /api/v1/products/:slug/reviews`
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getProductReviews = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page, limit } = req.validatedQuery;

  const payload = await service.getProductReviews(slug, { page, limit }, req.db);

  res.json({ success: true, data: payload });
});

/**
 * `GET /api/v1/search`
 *
 * The full results page. `q` is required by the schema, so an empty term is a 422
 * rather than an empty catalogue: `/search` with nothing typed is the search box,
 * not a listing of everything.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const search = asyncHandler(async (req, res) => {
  const payload = await service.listProducts(req.validatedQuery, req.db);

  res.json({
    success: true,
    data: { ...payload, query: req.validatedQuery.q },
  });
});

/**
 * `GET /api/v1/search/suggest`
 *
 * Predictive results for the search overlay. Separate from `/search` because the
 * payload is small, uncapped and shaped for typing against, and because the two
 * answers SHOULD differ: an overlay shows six best guesses, a results page shows
 * everything that matched.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const suggest = asyncHandler(async (req, res) => {
  const { q, limit } = req.validatedQuery;
  const payload = await service.searchProducts(q, { limit }, req.db);

  res.json({ success: true, data: payload });
});

/**
 * `GET /api/v1/products/:slug/related`
 *
 * Separate from the detail payload so the related rail can be deferred or fetched
 * on its own schedule. The detail endpoint includes it by default; a client that
 * passes `?includeRelated=0` and then wants it here does not need the whole product
 * again.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getRelatedProducts = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { limit } = req.validatedQuery;

  const { product } = await catalogue.findProductBySlug(slug, req.db);

  if (!product) throw service.productNotFound(slug);

  const related = await service.listRelatedProducts(product, { limit }, req.db);

  res.json({ success: true, data: { related } });
});

export default {
  listProducts,
  listCategories,
  getCategory,
  getProduct,
  getProductReviews,
  search,
  suggest,
  getRelatedProducts,
};
