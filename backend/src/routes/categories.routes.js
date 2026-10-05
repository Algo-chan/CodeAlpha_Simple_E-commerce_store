/**
 * Category routes.
 *
 * Split from `catalogue.routes.js` only because the mount points differ
 * (`/categories` rather than `/products`), not because the behaviour does.
 * A category page is a product listing scoped to a subtree, which is why it
 * validates the listing query rather than a smaller one.
 */
import { Router } from 'express';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/catalogue.controller.js';
import {
  listCategoriesQuerySchema,
  categorySlugParamSchema,
  buildCategoryProductsQuerySchema,
} from '../validators/catalogue.schema.js';

const router = Router();

/** Public and identical for every visitor, so it caches. */
router.use((req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  next();
});

/**
 * `GET /api/v1/categories`
 *
 * The nested tree by default, because navigation renders a tree. `?flat=1`
 * returns the un-nested rows, which is what a breadcrumb walker or a select
 * element wants — it should not have to flatten a tree it does not need.
 *
 * `?includeEmpty=0` drops categories with nothing in them, which keeps a leaf
 * that was never stocked out of the navigation.
 */
router.get('/', validateRequest({ query: listCategoriesQuerySchema }), controller.listCategories);

/**
 * `GET /api/v1/categories/:slug`
 *
 * The category node plus a paged, filtered, sorted listing of everything beneath
 * it, including descendants. One response so the header and the grid cannot
 * disagree about what is in scope.
 *
 * Validation runs in TWO STAGES, which is the reason the category query schema is
 * built rather than exported: the query schema needs the path slug to inject as
 * the category filter, and the slug is not known until params validate. The
 * listing schema for `/products` cannot do this, because it has no category in its
 * path and must not invent one.
 */
router.get(
  '/:slug',
  validateRequest({ params: categorySlugParamSchema }),
  (req, res, next) =>
    // Built per request from the already-validated slug, never from raw input.
    validateRequest({ query: buildCategoryProductsQuerySchema(req.params.slug) })(req, res, next),
  controller.getCategory
);

export default router;
