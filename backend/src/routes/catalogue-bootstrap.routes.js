/**
 * Catalogue bootstrap route.
 *
 * One read that returns everything the storefront shell needs before it can
 * render: every ACTIVE product as a DETAIL view model, plus the whole category
 * tree.
 *
 * WHY IT IS NOT JUST `/products`
 *
 * `/products` is a paged, filterable, sortable LISTING whose rows deliberately
 * omit the variant matrix and the full gallery, because a grid never reads them.
 * The shell is the opposite: it keeps the entire catalogue in memory, and every
 * later view — the client-side collection filters, the product page's variant
 * lookup, the home rails, the wishlist — reads from that one object. Bending
 * `/products?limit=…` into that job would mean either shipping variants on every
 * listing or an N+1, so the two concerns get two endpoints.
 *
 * It is public and identical for every visitor, so it caches exactly like the
 * rest of the catalogue.
 */
import { Router } from 'express';
import * as controller from '../controllers/catalogue.controller.js';

const router = Router();

/**
 * `GET /api/v1/catalogue`
 *
 * Same cache header as `catalogue.routes.js`: short enough that a price change
 * reaches the storefront quickly, long enough that a page view does not re-query
 * the database, with `stale-while-revalidate` so the shell paints from cache.
 */
router.use((req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  next();
});

router.get('/', controller.getCatalogue);

export default router;
