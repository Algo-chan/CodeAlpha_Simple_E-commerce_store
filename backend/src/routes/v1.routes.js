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
import paymentRoutes from './payment.routes.js';
import reviewRoutes from './review.routes.js';
import adminRoutes from './admin.routes.js';
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
 * Implemented: online payment intents and the signed provider webhook. COD stays
 * the default checkout method; this surface only moves ONLINE orders from
 * PENDING to PAID/FAILED after signature-verified notifications. `/payments`
 * sits in the placeholder list too, below, but the `implemented` set wins over
 * it exactly as it does for `/products`.
 */
router.use('/payments', paymentRoutes);

/*
 * Implemented: the customer-facing review write side. Reading a product's
 * reviews lives on `/products/:slug/reviews`; this surface lets a signed-in
 * customer who has received an order write the review that appears there.
 */
router.use('/reviews', reviewRoutes);

/*
 * Implemented: the store-management surface. The whole `/admin` tree sits
 * behind authenticate + authorize(ADMIN), so a customer who calls an admin
 * endpoint directly is refused at the router. `/admin` is listed in the
 * placeholder set below but the `implemented` set wins, exactly as it does for
 * `/payments`.
 */
router.use('/admin', adminRoutes);

/*
 * Not implemented. `users` is a later phase; answering 501 says "this URL does
 * not exist yet", which is true, rather than 404, which would suggest it never
 * will.
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
  '/payments',
  '/reviews',
  '/admin',
]);

for (const { path, name } of RESOURCE_PLACEHOLDERS) {
  if (implemented.has(path)) continue;
  router.use(path, createPlaceholderRouter(name));
}

export default router;
