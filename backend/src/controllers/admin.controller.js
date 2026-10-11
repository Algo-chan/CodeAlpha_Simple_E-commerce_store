/**
 * Admin controller — HTTP in, HTTP out for the store-management surface.
 *
 * Thin by design. It reads validated input off the request, calls exactly one
 * service function, and wraps the result in the standard envelope. Every rule
 * lives in a service; every query lives in a repository. The only thing this
 * file decides is status codes and the shape of a list response.
 *
 * AUTHORISATION IS NOT HERE. `/admin` is mounted behind `authenticate` +
 * `authorize(ADMIN)` and `requireSameOrigin` in the route file, so a request
 * that reaches a handler is already known to be an active administrator making a
 * same-origin call. There is deliberately no per-handler role check to forget.
 */
import { asyncHandler } from '../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../utils/http-response.js';
import * as dashboard from '../services/admin/dashboard.service.js';
import * as catalogue from '../services/admin/catalogue-admin.service.js';
import * as categories from '../services/admin/category-admin.service.js';
import * as inventory from '../services/admin/inventory-admin.service.js';
import * as orders from '../services/admin/order-admin.service.js';
import * as customers from '../services/admin/customer-admin.service.js';
import * as reviews from '../services/admin/review-admin.service.js';
import * as payments from '../services/admin/payment-admin.service.js';
import * as audit from '../services/admin/audit.service.js';

/** The validated query for a list endpoint. */
function query(req) {
  return req.validatedQuery ?? req.query;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

/** `GET /api/v1/admin/dashboard` */
export const getDashboard = asyncHandler(async (req, res) => {
  const data = await dashboard.getDashboard(req.db);
  return sendSuccess(res, { data: { dashboard: data } });
});

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

export const listProducts = asyncHandler(async (req, res) => {
  const result = await catalogue.listProducts(req.db, query(req));
  return sendSuccess(res, {
    data: { products: result.products },
    meta: { pagination: result.pagination },
  });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await catalogue.getProduct(req.db, req.params.id);
  return sendSuccess(res, { data: { product } });
});

export const createProduct = asyncHandler(async (req, res) => {
  const product = await catalogue.createProduct(req.db, req.user, req.body);
  return sendCreated(res, { product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await catalogue.updateProduct(req.db, req.user, req.params.id, req.body);
  return sendSuccess(res, { data: { product } });
});

export const archiveProduct = asyncHandler(async (req, res) => {
  const product = await catalogue.archiveProduct(req.db, req.user, req.params.id);
  return sendSuccess(res, { data: { product } });
});

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

export const listVariants = asyncHandler(async (req, res) => {
  const variants = await catalogue.listVariants(req.db, req.params.id);
  return sendSuccess(res, { data: { variants } });
});

export const createVariant = asyncHandler(async (req, res) => {
  const variants = await catalogue.createVariant(req.db, req.user, req.params.id, req.body);
  return sendCreated(res, { variants });
});

export const updateVariant = asyncHandler(async (req, res) => {
  const variants = await catalogue.updateVariant(req.db, req.user, req.params.variantId, req.body);
  return sendSuccess(res, { data: { variants } });
});

export const deactivateVariant = asyncHandler(async (req, res) => {
  const variants = await catalogue.deactivateVariant(req.db, req.user, req.params.variantId);
  return sendSuccess(res, { data: { variants } });
});

/* -------------------------------------------------------------------------- */
/* Product images                                                              */
/* -------------------------------------------------------------------------- */

export const listImages = asyncHandler(async (req, res) => {
  const images = await catalogue.listImages(req.db, req.params.id);
  return sendSuccess(res, { data: { images } });
});

export const createImage = asyncHandler(async (req, res) => {
  const images = await catalogue.createImage(req.db, req.user, req.params.id, req.body);
  return sendCreated(res, { images });
});

export const updateImage = asyncHandler(async (req, res) => {
  const images = await catalogue.updateImage(req.db, req.user, req.params.imageId, req.body);
  return sendSuccess(res, { data: { images } });
});

export const deleteImage = asyncHandler(async (req, res) => {
  const images = await catalogue.deleteImage(req.db, req.user, req.params.imageId);
  return sendSuccess(res, { data: { images } });
});

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export const listCategories = asyncHandler(async (req, res) => {
  const result = await categories.listCategories(req.db);
  return sendSuccess(res, { data: { categories: result.categories, tree: result.tree } });
});

export const getCategory = asyncHandler(async (req, res) => {
  const category = await categories.getCategory(req.db, req.params.id);
  return sendSuccess(res, { data: { category } });
});

export const createCategory = asyncHandler(async (req, res) => {
  const category = await categories.createCategory(req.db, req.user, req.body);
  return sendCreated(res, { category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await categories.updateCategory(req.db, req.user, req.params.id, req.body);
  return sendSuccess(res, { data: { category } });
});

export const archiveCategory = asyncHandler(async (req, res) => {
  const category = await categories.archiveCategory(req.db, req.user, req.params.id);
  return sendSuccess(res, { data: { category } });
});

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

export const listInventory = asyncHandler(async (req, res) => {
  const result = await inventory.listInventory(req.db, query(req));
  return sendSuccess(res, {
    data: { items: result.items },
    meta: { pagination: result.pagination },
  });
});

export const getLedger = asyncHandler(async (req, res) => {
  const result = await inventory.getLedger(req.db, req.params.variantId, query(req));
  return sendSuccess(res, {
    data: { variant: result.variant, entries: result.entries },
    meta: { pagination: result.pagination },
  });
});

export const adjustInventory = asyncHandler(async (req, res) => {
  const item = await inventory.adjustInventory(req.db, req.user, req.params.variantId, req.body);
  return sendSuccess(res, { data: { item } });
});

export const updateReorderLevel = asyncHandler(async (req, res) => {
  const item = await inventory.updateReorderLevel(req.db, req.user, req.params.variantId, req.body);
  return sendSuccess(res, { data: { item } });
});

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

export const listOrders = asyncHandler(async (req, res) => {
  const result = await orders.listOrders(req.db, query(req));
  return sendSuccess(res, {
    data: { orders: result.orders },
    meta: { pagination: result.pagination },
  });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await orders.getOrder(req.db, req.params.orderNumber);
  return sendSuccess(res, { data: { order } });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await orders.updateStatus(req.db, req.user, req.params.orderNumber, req.body);
  return sendSuccess(res, { data: { order } });
});

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

export const listCustomers = asyncHandler(async (req, res) => {
  const result = await customers.listCustomers(req.db, query(req));
  return sendSuccess(res, {
    data: { customers: result.customers },
    meta: { pagination: result.pagination },
  });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await customers.getCustomer(req.db, req.params.id);
  return sendSuccess(res, { data: { customer } });
});

export const updateCustomerStatus = asyncHandler(async (req, res) => {
  const customer = await customers.updateStatus(req.db, req.user, req.params.id, req.body);
  return sendSuccess(res, { data: { customer } });
});

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export const listReviews = asyncHandler(async (req, res) => {
  const result = await reviews.listReviews(req.db, query(req));
  return sendSuccess(res, {
    data: { reviews: result.reviews },
    meta: { pagination: result.pagination },
  });
});

export const getReview = asyncHandler(async (req, res) => {
  const review = await reviews.getReview(req.db, req.params.id);
  return sendSuccess(res, { data: { review } });
});

export const moderateReview = asyncHandler(async (req, res) => {
  const review = await reviews.moderate(req.db, req.user, req.params.id, req.body);
  return sendSuccess(res, { data: { review } });
});

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export const listPayments = asyncHandler(async (req, res) => {
  const result = await payments.listPayments(req.db, query(req));
  return sendSuccess(res, {
    data: { payments: result.payments },
    meta: { pagination: result.pagination },
  });
});

export const getPayment = asyncHandler(async (req, res) => {
  const payment = await payments.getPayment(req.db, req.params.id);
  return sendSuccess(res, { data: { payment } });
});

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await audit.listAuditLogs(req.db, query(req));
  return sendSuccess(res, { data: { logs: result.logs }, meta: { pagination: result.pagination } });
});

export default {
  getDashboard,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  archiveProduct,
  listVariants,
  createVariant,
  updateVariant,
  deactivateVariant,
  listImages,
  createImage,
  updateImage,
  deleteImage,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  listInventory,
  getLedger,
  adjustInventory,
  updateReorderLevel,
  listOrders,
  getOrder,
  updateOrderStatus,
  listCustomers,
  getCustomer,
  updateCustomerStatus,
  listReviews,
  getReview,
  moderateReview,
  listPayments,
  getPayment,
  listAuditLogs,
};
