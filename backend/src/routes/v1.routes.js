import { Router } from 'express';
import healthRoutes from './health.routes.js';
import productRoutes from './catalogue.routes.js';
import categoryRoutes from './categories.routes.js';
import searchRoutes from './search.routes.js';
import { RESOURCE_PLACEHOLDERS, createPlaceholderRouter } from './placeholder.routes.js';

/**
 * Version 1 of the API.
 *
 * Implemented resources are mounted here ahead of the placeholders, because a
 * placeholder router answers EVERYTHING on its path with 501. If `/products` were
 * still in the placeholder list it would also swallow `/categories`, and the two
 * real routers below would never be reached.
 *
 * Keeping the version in its own file means `/api/v2` can be added later without
 * touching existing endpoints.
 */
const router = Router();

router.use('/health', healthRoutes);

/* Implemented: read-only product discovery. */
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/search', searchRoutes);

/*
 * Not implemented. Accounts, cart, checkout, payments, orders and admin are all
 * later phases; answering 501 says "this URL does not exist yet", which is true,
 * rather than 404, which would suggest it never will.
 */
const implemented = new Set(['/products', '/categories', '/search']);

for (const { path, name } of RESOURCE_PLACEHOLDERS) {
  if (implemented.has(path)) continue;
  router.use(path, createPlaceholderRouter(name));
}

export default router;
