/**
 * Admin view — the single mapping from admin query rows to what the management
 * API returns.
 *
 * Two rules, carried over from the customer-facing view:
 *
 *   1. SNAKE_CASE STOPS HERE. Repositories speak the database's language and
 *      return snake_case columns; the API speaks camelCase. Converting in one
 *      place means a column rename is a change to one file, not a hunt through
 *      controllers.
 *
 *   2. NOTHING INTERNAL LEAKS. `password_hash`, session tokens and internal-only
 *      columns are never selected by the repositories and so cannot appear here.
 *      Customer views expose the customer's own email (an operator needs to
 *      contact them) but never a credential.
 *
 * Money is passed through as integer minor units; the frontend divides by 100
 * at the one formatting boundary. No view model ever emits a float price.
 */
import { toOrderView, toOrderSummary } from './order.view.js';
import { buildCategoryTree } from '../repositories/category.repository.js';

/** Coerces a value to a Number, or null when absent. */
function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function iso(value) {
  return value ?? null;
}

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

function toProductCategory(row) {
  if (!row.category_id) return null;
  return { id: row.category_id, name: row.category_name ?? null, slug: row.category_slug ?? null };
}

export function toAdminProductListItem(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    status: row.status,
    productType: row.product_type,
    brand: row.brand ?? null,
    category: toProductCategory(row),
    variantCount: num(row.variant_count) ?? 0,
    activeVariantCount: num(row.active_variant_count) ?? 0,
    totalStock: num(row.total_stock) ?? 0,
    priceMin: num(row.price_min_minor),
    priceMax: num(row.price_max_minor),
    primaryImageUrl: row.primary_image_url ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toAdminVariant(row) {
  const tracked = row.quantity !== null && row.quantity !== undefined;
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    price: Number(row.price),
    compareAtPrice: num(row.compare_at_price),
    attributes: row.attributes ?? {},
    isActive: Boolean(row.is_active),
    inventory: tracked
      ? {
          quantity: Number(row.quantity),
          reservedQuantity: Number(row.reserved_quantity ?? 0),
          available:
            num(row.available) ?? Number(row.quantity) - Number(row.reserved_quantity ?? 0),
          reorderLevel: Number(row.reorder_level ?? 0),
        }
      : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toAdminImage(row) {
  return {
    id: row.id,
    productId: row.product_id,
    imageUrl: row.image_url,
    altText: row.alt_text ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    isPrimary: Boolean(row.is_primary),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * A full product: header, variants (with their stock) and gallery.
 *
 * `inventoryTracked` is derived from whether any variant carries an inventory
 * row, so the UI can explain why a DIGITAL product shows no stock rather than
 * rendering an empty stock section as though something were missing.
 */
export function toAdminProductDetail({ product, variants = [], images = [] }) {
  const mappedVariants = variants.map(toAdminVariant);
  return {
    ...toAdminProductListItem({
      ...product,
      variant_count: variants.length,
      active_variant_count: variants.filter((v) => v.is_active).length,
      total_stock: variants.reduce(
        (sum, v) =>
          sum + Math.max((Number(v.quantity) || 0) - (Number(v.reserved_quantity) || 0), 0),
        0
      ),
      price_min_minor: variants.length ? Math.min(...variants.map((v) => Number(v.price))) : null,
      price_max_minor: variants.length ? Math.max(...variants.map((v) => Number(v.price))) : null,
    }),
    variants: mappedVariants,
    images: images.map(toAdminImage),
    inventoryTracked: variants.some((v) => v.quantity !== null && v.quantity !== undefined),
  };
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export function toAdminCategory(row) {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
    directProductCount: Number(row.direct_product_count ?? 0),
    totalProductCount: Number(row.total_product_count ?? 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * The admin category tree.
 *
 * Reuses the storefront `buildCategoryTree` for depth/path/ordering, then
 * enriches each node with the admin-only fields. The storefront helper filters
 * on `is_active`, which administration must not do, so the tree is built from
 * the full list and the helper's output is treated as a structural skeleton.
 */
export function toAdminCategoryTree(rows) {
  const compatRows = rows.map((row) => ({ ...row, product_count: row.total_product_count }));
  const tree = buildCategoryTree(compatRows);

  const decorate = (node) => {
    const source = rows.find((row) => String(row.id) === node.id) ?? {};
    return {
      id: node.id,
      parentId: node.parent_id,
      name: node.name,
      slug: node.slug,
      description: node.description,
      imageUrl: node.image_url,
      isActive: Boolean(source.is_active),
      sortOrder: node.sort_order,
      depth: node.depth,
      directProductCount: node.direct_product_count,
      totalProductCount: node.product_count,
      children: node.children.map(decorate),
    };
  };

  return tree.map(decorate);
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

export function toAdminInventoryItem(row) {
  return {
    variantId: row.variant_id,
    sku: row.sku,
    price: Number(row.price),
    isActive: Boolean(row.is_active),
    attributes: row.attributes ?? {},
    product: {
      id: row.product_id,
      name: row.product_name,
      slug: row.product_slug,
      status: row.product_status,
    },
    quantity: Number(row.quantity),
    reservedQuantity: Number(row.reserved_quantity),
    available: Number(row.available),
    reorderLevel: Number(row.reorder_level),
    isLowStock: Boolean(row.is_low_stock),
    updatedAt: iso(row.updated_at),
  };
}

export function toAdminLedgerEntry(row) {
  return {
    id: row.id,
    variantId: row.variant_id,
    type: row.transaction_type,
    quantity: Number(row.quantity),
    referenceType: row.reference_type ?? null,
    referenceId: row.reference_id ?? null,
    note: row.note ?? null,
    createdBy: row.created_by ? { id: row.created_by, name: row.created_by_name ?? null } : null,
    createdAt: iso(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

export function toAdminOrderListItem(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    discountTotal: Number(row.discount_total),
    total: Number(row.total),
    customer: {
      id: row.user_id ?? null,
      name: row.customer_name ?? null,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    latestPayment: row.latest_payment_status
      ? {
          method: row.latest_payment_method ?? null,
          status: row.latest_payment_status,
          reference: row.latest_payment_reference ?? null,
        }
      : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * Admin order detail. Delegates to the shared order view for the customer-facing
 * shape (so admin and customer never disagree about what an order is) and adds
 * only the internal address book id the operator tools need.
 */
export function toAdminOrderDetail({ order, items = [], payment = null }) {
  return {
    ...toOrderView({ order, items, payment }),
    customerId: order.user_id ?? null,
  };
}

export { toOrderSummary };

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

export function toAdminCustomerListItem(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    role: row.role,
    status: row.status,
    orderCount: Number(row.order_count ?? 0),
    totalSpent: Number(row.total_spent ?? 0),
    createdAt: iso(row.created_at),
    lastLoginAt: iso(row.last_login_at),
  };
}

export function toAdminCustomerDetail({ customer, orders = [], ordersTotal = 0 }) {
  return {
    ...toAdminCustomerListItem({
      ...customer,
      order_count: customer.order_count,
      total_spent: customer.total_spent,
    }),
    cancelledCount: Number(customer.cancelled_count ?? 0),
    updatedAt: iso(customer.updated_at),
    passwordChangedAt: iso(customer.password_changed_at),
    recentOrders: orders.map((row) => ({
      orderNumber: row.order_number,
      status: row.status,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      total: Number(row.total),
      currency: row.currency,
      createdAt: iso(row.created_at),
    })),
    ordersTotal,
  };
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export function toAdminReview(row) {
  return {
    id: row.id,
    rating: Number(row.rating),
    title: row.title ?? null,
    comment: row.comment ?? null,
    status: row.status,
    reviewer: {
      id: row.user_id,
      name: row.reviewer_name ?? null,
      email: row.reviewer_email ?? null,
    },
    product: {
      id: row.product_id,
      name: row.product_name ?? null,
      slug: row.product_slug ?? null,
    },
    moderation: row.moderated_by
      ? {
          moderatorId: row.moderated_by,
          moderatorName: row.moderator_name ?? null,
          moderatedAt: iso(row.moderated_at),
          note: row.moderation_note ?? null,
        }
      : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export function toAdminPayment(row) {
  return {
    id: row.id,
    provider: row.provider,
    method: row.method,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    transactionReference: row.transaction_reference ?? null,
    failureReason: row.failure_reason ?? null,
    paidAt: iso(row.paid_at),
    order: {
      id: row.order_id,
      orderNumber: row.order_number ?? null,
      customerEmail: row.customer_email ?? null,
      customerPhone: row.customer_phone ?? null,
      status: row.order_status ?? null,
      paymentStatus: row.order_payment_status ?? null,
      total: num(row.order_total),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard and audit                                                         */
/* -------------------------------------------------------------------------- */

export function toAdminDashboard({
  orders,
  products,
  customers,
  lowStockCount,
  pendingReviews,
  recentOrders,
}) {
  return {
    orders: {
      total: Number(orders.total_orders ?? 0),
      byStatus: {
        pending: Number(orders.pending_orders ?? 0),
        confirmed: Number(orders.confirmed_orders ?? 0),
        processing: Number(orders.processing_orders ?? 0),
        shipped: Number(orders.shipped_orders ?? 0),
        delivered: Number(orders.delivered_orders ?? 0),
        cancelled: Number(orders.cancelled_orders ?? 0),
      },
      grossSales: Number(orders.gross_sales_minor ?? 0),
      paidRevenue: Number(orders.paid_revenue_minor ?? 0),
      pendingPayment: Number(orders.pending_payment_minor ?? 0),
    },
    products: {
      total: Number(products.total_products ?? 0),
      active: Number(products.active_products ?? 0),
      draft: Number(products.draft_products ?? 0),
      archived: Number(products.archived_products ?? 0),
    },
    customers: {
      total: Number(customers.total_customers ?? 0),
      active: Number(customers.active_customers ?? 0),
      suspended: Number(customers.suspended_customers ?? 0),
    },
    lowStockCount: Number(lowStockCount ?? 0),
    pendingReviews: Number(pendingReviews ?? 0),
    recentOrders: (recentOrders ?? []).map((row) => ({
      orderNumber: row.order_number,
      status: row.status,
      paymentStatus: row.payment_status,
      total: Number(row.total),
      currency: row.currency,
      customerEmail: row.customer_email,
      createdAt: iso(row.created_at),
    })),
  };
}

export function toAuditLog(row) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? null,
    summary: row.summary ?? null,
    changes: row.changes ?? null,
    actor:
      row.actor_id || row.actor_email
        ? { id: row.actor_id ?? null, email: row.actor_email ?? null }
        : null,
    createdAt: iso(row.created_at),
  };
}

export default {
  toAdminProductListItem,
  toAdminProductDetail,
  toAdminVariant,
  toAdminImage,
  toAdminCategory,
  toAdminCategoryTree,
  toAdminInventoryItem,
  toAdminLedgerEntry,
  toAdminOrderListItem,
  toAdminOrderDetail,
  toOrderSummary,
  toAdminCustomerListItem,
  toAdminCustomerDetail,
  toAdminReview,
  toAdminPayment,
  toAdminDashboard,
  toAuditLog,
};
