import { Router } from 'express';
import healthRoutes from './health.routes.js';
import { RESOURCE_PLACEHOLDERS, createPlaceholderRouter } from './placeholder.routes.js';

/**
 * Version 1 of the API.
 *
 * Resource routers are mounted here as they are implemented, e.g.
 *   router.use('/products', productRoutes);
 *
 * Keeping the version in its own file means `/api/v2` can be added later
 * without touching existing endpoints.
 */
const router = Router();

router.use('/health', healthRoutes);

for (const { path, name } of RESOURCE_PLACEHOLDERS) {
  router.use(path, createPlaceholderRouter(name));
}

export default router;
