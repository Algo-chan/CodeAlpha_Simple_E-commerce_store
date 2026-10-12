/**
 * Admin API client.
 *
 * A thin, named wrapper over the shared `core/api.js` client. It exists so the
 * console's sections never build a URL or dig a key out of the response
 * envelope by hand — one place owns "the dashboard lives at /admin/dashboard and
 * its payload is `data.dashboard`".
 *
 * `createAdminApi(client)` takes the transport, which is what lets the Node
 * tests drive every call against a recording fake with no network and no
 * browser. The default export is bound to the real client.
 */
import { api as defaultClient } from '../core/api.js';

/** Reads `meta.pagination`, tolerating a client without `getPage`. */
function paginated(getPage, path, query) {
  return getPage(path, { query }).then(({ data, meta }) => ({
    data,
    pagination: meta?.pagination ?? null,
  }));
}

/**
 * @param {object} [client] a transport with get/getPage/post/patch/delete
 */
export function createAdminApi(client = defaultClient) {
  // `getPage` is a real method on the shipped client; an injected test double
  // may only implement `get`, so fall back to it and report null pagination.
  const getPage = client.getPage
    ? client.getPage.bind(client)
    : (path, options) => client.get(path, options).then((data) => ({ data, meta: null }));

  return {
    /* Dashboard ------------------------------------------------------------ */
    getDashboard: () => client.get('/admin/dashboard').then((data) => data.dashboard),

    /* Products ------------------------------------------------------------- */
    listProducts: (query) =>
      paginated(getPage, '/admin/products', query).then(({ data, pagination }) => ({
        products: data.products,
        pagination,
      })),
    getProduct: (id) => client.get(`/admin/products/${id}`).then((data) => data.product),
    createProduct: (body) => client.post('/admin/products', body).then((data) => data.product),
    updateProduct: (id, body) =>
      client.patch(`/admin/products/${id}`, body).then((data) => data.product),
    archiveProduct: (id) =>
      client.post(`/admin/products/${id}/archive`).then((data) => data.product),

    /* Variants ------------------------------------------------------------- */
    listVariants: (productId) =>
      client.get(`/admin/products/${productId}/variants`).then((data) => data.variants),
    createVariant: (productId, body) =>
      client.post(`/admin/products/${productId}/variants`, body).then((data) => data.variants),
    updateVariant: (variantId, body) =>
      client.patch(`/admin/variants/${variantId}`, body).then((data) => data.variants),
    deactivateVariant: (variantId) =>
      client.delete(`/admin/variants/${variantId}`).then((data) => data.variants),

    /* Images --------------------------------------------------------------- */
    listImages: (productId) =>
      client.get(`/admin/products/${productId}/images`).then((data) => data.images),
    createImage: (productId, body) =>
      client.post(`/admin/products/${productId}/images`, body).then((data) => data.images),
    updateImage: (imageId, body) =>
      client.patch(`/admin/images/${imageId}`, body).then((data) => data.images),
    deleteImage: (imageId) => client.delete(`/admin/images/${imageId}`).then((data) => data.images),

    /* Categories ----------------------------------------------------------- */
    listCategories: () =>
      client.get('/admin/categories').then((data) => ({
        categories: data.categories,
        tree: data.tree,
      })),
    getCategory: (id) => client.get(`/admin/categories/${id}`).then((data) => data.category),
    createCategory: (body) => client.post('/admin/categories', body).then((data) => data.category),
    updateCategory: (id, body) =>
      client.patch(`/admin/categories/${id}`, body).then((data) => data.category),
    archiveCategory: (id) =>
      client.post(`/admin/categories/${id}/archive`).then((data) => data.category),

    /* Inventory ------------------------------------------------------------ */
    listInventory: (query) =>
      paginated(getPage, '/admin/inventory', query).then(({ data, pagination }) => ({
        items: data.items,
        pagination,
      })),
    getLedger: (variantId, query) =>
      paginated(getPage, `/admin/inventory/${variantId}/ledger`, query).then(
        ({ data, pagination }) => ({
          variant: data.variant,
          entries: data.entries,
          pagination,
        })
      ),
    adjustInventory: (variantId, body) =>
      client.post(`/admin/inventory/${variantId}/adjust`, body).then((data) => data.item),
    updateReorderLevel: (variantId, body) =>
      client.patch(`/admin/inventory/${variantId}`, body).then((data) => data.item),

    /* Orders --------------------------------------------------------------- */
    listOrders: (query) =>
      paginated(getPage, '/admin/orders', query).then(({ data, pagination }) => ({
        orders: data.orders,
        pagination,
      })),
    getOrder: (orderNumber) =>
      client.get(`/admin/orders/${encodeURIComponent(orderNumber)}`).then((data) => data.order),
    updateOrderStatus: (orderNumber, body) =>
      client
        .patch(`/admin/orders/${encodeURIComponent(orderNumber)}/status`, body)
        .then((data) => data.order),

    /* Customers ------------------------------------------------------------ */
    listCustomers: (query) =>
      paginated(getPage, '/admin/customers', query).then(({ data, pagination }) => ({
        customers: data.customers,
        pagination,
      })),
    getCustomer: (id) => client.get(`/admin/customers/${id}`).then((data) => data.customer),
    updateCustomerStatus: (id, body) =>
      client.patch(`/admin/customers/${id}/status`, body).then((data) => data.customer),

    /* Reviews -------------------------------------------------------------- */
    listReviews: (query) =>
      paginated(getPage, '/admin/reviews', query).then(({ data, pagination }) => ({
        reviews: data.reviews,
        pagination,
      })),
    getReview: (id) => client.get(`/admin/reviews/${id}`).then((data) => data.review),
    moderateReview: (id, body) =>
      client.patch(`/admin/reviews/${id}/status`, body).then((data) => data.review),

    /* Payments ------------------------------------------------------------- */
    listPayments: (query) =>
      paginated(getPage, '/admin/payments', query).then(({ data, pagination }) => ({
        payments: data.payments,
        pagination,
      })),
    getPayment: (id) => client.get(`/admin/payments/${id}`).then((data) => data.payment),

    /* Audit ---------------------------------------------------------------- */
    listAuditLogs: (query) =>
      paginated(getPage, '/admin/audit-logs', query).then(({ data, pagination }) => ({
        logs: data.logs,
        pagination,
      })),

    /* Coupons -------------------------------------------------------------- */
    listCoupons: (query) =>
      paginated(getPage, '/admin/coupons', query).then(({ data, pagination }) => ({
        coupons: data.coupons,
        pagination,
      })),
    getCoupon: (id) => client.get(`/admin/coupons/${id}`).then((data) => data.coupon),
    createCoupon: (body) => client.post('/admin/coupons', body).then((data) => data.coupon),
    updateCoupon: (id, body) =>
      client.patch(`/admin/coupons/${id}`, body).then((data) => data.coupon),
    activateCoupon: (id) =>
      client.post(`/admin/coupons/${id}/activate`).then((data) => data.coupon),
    deactivateCoupon: (id) =>
      client.post(`/admin/coupons/${id}/deactivate`).then((data) => data.coupon),
  };
}

export const adminApi = createAdminApi();

export default adminApi;
