import { Router } from 'express';
import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

/**
 * Resource placeholders.
 *
 * Each entry mounts a router that answers every request with
 * 501 NOT_IMPLEMENTED. This keeps the URL surface visible and documented
 * WITHOUT containing any business logic. When a resource is built, replace its
 * entry with a real router file:
 *
 *   router.use('/products', productsRoutes);
 *
 * Naming: the path is the public URL, the name appears in the error message.
 */
export const RESOURCE_PLACEHOLDERS = [
  { path: '/auth', name: 'Authentication' },
  { path: '/products', name: 'Products' },
  { path: '/categories', name: 'Categories' },
  { path: '/cart', name: 'Cart' },
  { path: '/wishlist', name: 'Wishlist' },
  { path: '/orders', name: 'Orders' },
  { path: '/payments', name: 'Payments' },
  { path: '/reviews', name: 'Reviews' },
  { path: '/users', name: 'Users' },
  { path: '/admin', name: 'Admin' },
];

/**
 * Builds a router that reports "not implemented yet" for every request.
 * @param {string} resourceName
 */
export function createPlaceholderRouter(resourceName) {
  const router = Router();

  router.use((req, res, next) => {
    next(
      new AppError(`${resourceName} API is not implemented yet.`, 501, ERROR_CODES.NOT_IMPLEMENTED)
    );
  });

  return router;
}

export default RESOURCE_PLACEHOLDERS;
