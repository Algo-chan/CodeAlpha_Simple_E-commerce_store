/**
 * Catalogue routes — the read-only product discovery surface.
 *
 * ROUTE ORDER IS LOAD-BEARING
 *
 * `/products/:slug` would otherwise swallow `/products/featured`, and a slug
 * validator would reject it with a 422 instead of the 404 it should be. Static
 * segments are declared before the parameterised ones for that reason. Express
 * matches in declaration order and stops at the first hit.
 *
 * EVERY ROUTE IS READ-ONLY AND UNAUTHENTICATED
 *
 * Browsing a shop needs no account. Nothing here writes, and no account,
 * checkout, payment or admin resource is mounted: those placeholders stay in
 * `placeholder.routes.js` and still answer 501, which is the honest response for
 * an endpoint that genuinely does not exist yet.
 *
 * CACHING
 *
 * Catalogue responses are public and identical for every visitor, so every route
 * sets `Cache-Control: public, max-age=60`. Sixty seconds is short enough that a
 * price change reaches the storefront quickly and long enough that a page view
 * does not re-query the database on every navigation. `stale-while-revalidate`
 * lets the page paint from cache while one request refreshes it in the
 * background.
 */
import { Router } from 'express';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/catalogue.controller.js';
import {
  listProductsQuerySchema,
  productSlugParamSchema,
  productSlugQuerySchema,
  reviewsQuerySchema,
} from '../validators/catalogue.schema.js';
import { z } from 'zod';

/** Shared listing-query validation. */
const validateListing = validateRequest({ query: listProductsQuerySchema });

/** `/products/:slug?includeRelated=0` */
const validateProduct = validateRequest({
  params: productSlugParamSchema,
  query: productSlugQuerySchema,
});

/** `/products/:slug/reviews?page=2&limit=10` */
const validateReviews = validateRequest({
  params: productSlugParamSchema,
  query: reviewsQuerySchema,
});

/** `/products/:slug/related?limit=4` */
const validateRelated = validateRequest({
  params: productSlugParamSchema,
  query: z
    .object({
      limit: z.coerce
        .number()
        .int('limit must be a whole number')
        .min(1)
        .max(12, 'limit must be 12 or fewer')
        .default(4),
    })
    .strip(),
});

/**
 * Every catalogue response is publicly cacheable.
 *
 * The header is set here rather than per handler so a route added later cannot
 * forget it. `public` is safe precisely because nothing here is per-user: no
 * cart, no account, no wishlist.
 */
function cachePublicly(req, res, next) {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  next();
}

const router = Router();

router.use(cachePublicly);

/* -------------------------------------------------------------------------- */
/* Products                                                                      */
/* -------------------------------------------------------------------------- */

router.get('/', validateListing, controller.listProducts);

router.get('/:slug', validateProduct, controller.getProduct);

router.get('/:slug/reviews', validateReviews, controller.getProductReviews);

router.get('/:slug/related', validateRelated, controller.getRelatedProducts);

export default router;
