/**
 * Search routes.
 *
 * Separate from `catalogue.routes.js` because search is a different RESOURCE with
 * a different rule: `q` is mandatory. A listing may legitimately be called with no
 * parameters at all; a search may not, because `/search` with nothing typed is the
 * search box, not a request for everything. Keeping them apart means the required
 * `q` cannot leak into the product listing's schema, where it would break
 * `/api/v1/products`.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/catalogue.controller.js';
import { searchQuerySchema, MAX_QUERY_LENGTH } from '../validators/catalogue.schema.js';

const router = Router();

/**
 * Search results are public and identical for every visitor, so they cache.
 * See `catalogue.routes.js` for the reasoning behind the exact header.
 */
router.use((req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  next();
});

/**
 * `GET /api/v1/search?q=...` — the full results page.
 *
 * Supports the same filters, sorts and pagination as the product listing, because
 * a shopper who narrowed a search in the sidebar expects the same controls on the
 * results page.
 */
router.get('/', validateRequest({ query: searchQuerySchema }), controller.search);

/**
 * `GET /api/v1/search/suggest?q=...` — the overlay's predictive results.
 *
 * Declared AFTER `/search` deliberately. The paths are distinct so this would work
 * in either order, but keeping the specific route last means a future `/search/:id`
 * cannot shadow it.
 *
 * `limit` is capped at 12 because this runs on every keystroke: the overlay needs
 * enough rows to be useful and no more, and an unbounded query here is the easiest
 * way for a search box to become a denial-of-service amplifier.
 */
router.get(
  '/suggest',
  validateRequest({
    query: z.object({
      q: z.string().trim().min(1, 'enter something to search for').max(MAX_QUERY_LENGTH),
      limit: z.coerce
        .number()
        .int('limit must be a whole number')
        .min(1)
        .max(12, 'limit must be 12 or fewer')
        .default(6),
    }),
  }),
  controller.suggest
);

export default router;
