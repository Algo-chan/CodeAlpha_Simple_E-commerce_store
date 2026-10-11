/**
 * Admin routes — the store-management surface.
 *
 * ONE GATE FOR THE WHOLE TREE. The three middlewares below run before any admin
 * handler, in this order:
 *
 *   authenticate          a valid session cookie resolves an ACTIVE user, or 401
 *   authorize(ADMIN)      that user's role is ADMIN, or 403
 *   requireSameOrigin     a state-changing call carries a same-origin Origin
 *
 * Because the gate is mounted on the router, it applies to every path beneath
 * `/admin` — including any endpoint added later. There is no per-route role
 * check to remember, and no path that can be reached by a customer: a CUSTOMER
 * calling `GET /api/v1/admin/products` by hand is stopped by `authorize` before
 * the controller runs. Hiding the UI is not, and was never intended to be, the
 * security boundary.
 */
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireSameOrigin } from '../middleware/csrf.js';
import { validateRequest } from '../middleware/validate.js';
import { ROLES } from '../config/constants.js';
import {
  uuidIdParamSchema,
  variantIdParamSchema,
  imageIdParamSchema,
  orderNumberAdminParamSchema,
  adminProductQuerySchema,
  createProductSchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema,
  createImageSchema,
  updateImageSchema,
  createCategorySchema,
  updateCategorySchema,
  adjustInventorySchema,
  updateReorderLevelSchema,
  adminInventoryQuerySchema,
  adminOrderQuerySchema,
  updateOrderStatusSchema,
  adminCustomerQuerySchema,
  updateCustomerStatusSchema,
  adminReviewQuerySchema,
  moderateReviewSchema,
  adminPaymentQuerySchema,
  adminAuditQuerySchema,
} from '../validators/admin.schema.js';
import * as controller from '../controllers/admin.controller.js';

const router = Router();

router.use(authenticate, authorize(ROLES.ADMIN), requireSameOrigin);

/* Dashboard ----------------------------------------------------------------- */
router.get('/dashboard', controller.getDashboard);

/* Products ------------------------------------------------------------------ */
router.get(
  '/products',
  validateRequest({ query: adminProductQuerySchema }),
  controller.listProducts
);
router.post('/products', validateRequest({ body: createProductSchema }), controller.createProduct);
router.get('/products/:id', validateRequest({ params: uuidIdParamSchema }), controller.getProduct);
router.patch(
  '/products/:id',
  validateRequest({ params: uuidIdParamSchema, body: updateProductSchema }),
  controller.updateProduct
);
router.post(
  '/products/:id/archive',
  validateRequest({ params: uuidIdParamSchema }),
  controller.archiveProduct
);

/* Variants ------------------------------------------------------------------ */
router.get(
  '/products/:id/variants',
  validateRequest({ params: uuidIdParamSchema }),
  controller.listVariants
);
router.post(
  '/products/:id/variants',
  validateRequest({ params: uuidIdParamSchema, body: createVariantSchema }),
  controller.createVariant
);
router.patch(
  '/variants/:variantId',
  validateRequest({ params: variantIdParamSchema, body: updateVariantSchema }),
  controller.updateVariant
);
router.delete(
  '/variants/:variantId',
  validateRequest({ params: variantIdParamSchema }),
  controller.deactivateVariant
);

/* Product images ------------------------------------------------------------ */
router.get(
  '/products/:id/images',
  validateRequest({ params: uuidIdParamSchema }),
  controller.listImages
);
router.post(
  '/products/:id/images',
  validateRequest({ params: uuidIdParamSchema, body: createImageSchema }),
  controller.createImage
);
router.patch(
  '/images/:imageId',
  validateRequest({ params: imageIdParamSchema, body: updateImageSchema }),
  controller.updateImage
);
router.delete(
  '/images/:imageId',
  validateRequest({ params: imageIdParamSchema }),
  controller.deleteImage
);

/* Categories ---------------------------------------------------------------- */
router.get('/categories', controller.listCategories);
router.post(
  '/categories',
  validateRequest({ body: createCategorySchema }),
  controller.createCategory
);
router.get(
  '/categories/:id',
  validateRequest({ params: uuidIdParamSchema }),
  controller.getCategory
);
router.patch(
  '/categories/:id',
  validateRequest({ params: uuidIdParamSchema, body: updateCategorySchema }),
  controller.updateCategory
);
router.post(
  '/categories/:id/archive',
  validateRequest({ params: uuidIdParamSchema }),
  controller.archiveCategory
);

/* Inventory ----------------------------------------------------------------- */
router.get(
  '/inventory',
  validateRequest({ query: adminInventoryQuerySchema }),
  controller.listInventory
);
router.get(
  '/inventory/:variantId/ledger',
  validateRequest({ params: variantIdParamSchema, query: adminInventoryQuerySchema }),
  controller.getLedger
);
router.post(
  '/inventory/:variantId/adjust',
  validateRequest({ params: variantIdParamSchema, body: adjustInventorySchema }),
  controller.adjustInventory
);
router.patch(
  '/inventory/:variantId',
  validateRequest({ params: variantIdParamSchema, body: updateReorderLevelSchema }),
  controller.updateReorderLevel
);

/* Orders -------------------------------------------------------------------- */
router.get('/orders', validateRequest({ query: adminOrderQuerySchema }), controller.listOrders);
router.get(
  '/orders/:orderNumber',
  validateRequest({ params: orderNumberAdminParamSchema }),
  controller.getOrder
);
router.patch(
  '/orders/:orderNumber/status',
  validateRequest({ params: orderNumberAdminParamSchema, body: updateOrderStatusSchema }),
  controller.updateOrderStatus
);

/* Customers ----------------------------------------------------------------- */
router.get(
  '/customers',
  validateRequest({ query: adminCustomerQuerySchema }),
  controller.listCustomers
);
router.get(
  '/customers/:id',
  validateRequest({ params: uuidIdParamSchema }),
  controller.getCustomer
);
router.patch(
  '/customers/:id/status',
  validateRequest({ params: uuidIdParamSchema, body: updateCustomerStatusSchema }),
  controller.updateCustomerStatus
);

/* Reviews ------------------------------------------------------------------- */
router.get('/reviews', validateRequest({ query: adminReviewQuerySchema }), controller.listReviews);
router.get('/reviews/:id', validateRequest({ params: uuidIdParamSchema }), controller.getReview);
router.patch(
  '/reviews/:id/status',
  validateRequest({ params: uuidIdParamSchema, body: moderateReviewSchema }),
  controller.moderateReview
);

/* Payments ------------------------------------------------------------------ */
router.get(
  '/payments',
  validateRequest({ query: adminPaymentQuerySchema }),
  controller.listPayments
);
router.get('/payments/:id', validateRequest({ params: uuidIdParamSchema }), controller.getPayment);

/* Audit --------------------------------------------------------------------- */
router.get(
  '/audit-logs',
  validateRequest({ query: adminAuditQuerySchema }),
  controller.listAuditLogs
);

export default router;
