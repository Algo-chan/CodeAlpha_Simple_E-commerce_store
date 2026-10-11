import { Router } from 'express';
import healthRoutes from './health.routes.js';
import productRoutes from './catalogue.routes.js';
import categoryRoutes from './categories.routes.js';
import searchRoutes from './search.routes.js';
import authRoutes from './auth.routes.js';
import cartRoutes from './cart.routes.js';
import wishlistRoutes from './wishlist.routes.js';
import checkoutRoutes from './checkout.routes.js';
import orderRoutes from './order.routes.js';
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

/* Implemented: customer authentication and the account surface. */
router.use('/auth', authRoutes);

/* Implemented: customer/guest cart and the authenticated wishlist. */
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);

/* Implemented: checkout (cart -> order) and a customer's own order history. */
router.use('/checkout', checkoutRoutes);
router.use('/orders', orderRoutes);

/*
 * Not implemented. Payments and admin are later phases; answering 501 says
 * "this URL does not exist yet", which is true, rather than 404, which would
 * suggest it never will. `/payments` stays here on purpose: checkout writes a
 * payment row, but there is no payment-provider API in this phase.
 */
const implemented = new Set([
  '/products',
  '/categories',
  '/search',
  '/auth',
  '/cart',
  '/wishlist',
  '/checkout',
  '/orders',
]);

for (const { path, name } of RESOURCE_PLACEHOLDERS) {
  if (implemented.has(path)) continue;
  router.use(path, createPlaceholderRouter(name));
}

export default router;
