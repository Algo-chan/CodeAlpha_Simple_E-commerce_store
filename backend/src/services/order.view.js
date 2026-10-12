/**
 * Order view — the single mapping from order rows to what an API client sees.
 *
 * Two rules drive every field here:
 *
 *   1. NO INTERNAL IDS. The order is addressed by its human-readable
 *      `orderNumber`; the database `id`, `user_id` and `order_items.id` never
 *      leave the server. Nothing a customer can see needs them, and exposing
 *      them invites clients to depend on a primary key that is not an API.
 *
 *   2. SNAPSHOTS WIN. Name, SKU, options and price come from the order itself,
 *      never from the live product. A price change tomorrow must not rewrite
 *      what the customer was shown today.
 *
 * The same shape is used by checkout confirmation, order history and order
 * detail, so the three surfaces cannot drift.
 */
import { buildVariantLabel, normaliseAttributes } from './catalogue.view.js';
import { estimateDelivery } from './delivery.service.js';

/** Normalises the JSONB snapshot's snake_case keys into the client's camelCase. */
function toAddressView(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    label: source.label ?? null,
    fullName: source.full_name ?? '',
    phone: source.phone ?? '',
    city: source.city ?? '',
    area: source.area ?? '',
    street: source.street ?? '',
    landmark: source.landmark ?? null,
    additionalNotes: source.additional_notes ?? null,
  };
}

function toItemView(row) {
  const attributes = normaliseAttributes(row.variant_attributes);
  return {
    productName: row.product_name,
    sku: row.sku ?? null,
    variantAttributes: attributes,
    variantLabel: buildVariantLabel(attributes),
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
    subtotal: Number(row.subtotal),
  };
}

/** The payment story for an order, from its latest `payments` row. */
function toPaymentView(order, payment) {
  return {
    method: order.payment_method,
    status: order.payment_status,
    provider: payment?.provider ?? null,
    amount: payment ? Number(payment.amount) : Number(order.total),
    currency: order.currency,
    paidAt: payment?.paid_at ?? null,
  };
}

/**
 * A full order: header, lines, delivery and payment.
 *
 * @param {{ order: object, items: object[], payment?: object|null }} input
 */
export function toOrderView({ order, items = [], payment = null }) {
  const address = toAddressView(order.shipping_address_snapshot);
  // The ETA is derived from the frozen destination snapshot by the same rule as
  // at checkout, so the confirmation and the history page never drift.
  const delivery = estimateDelivery({ city: address.city, area: address.area });

  return {
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.delivery_fee),
    discountTotal: Number(order.discount_total),
    couponCode: order.coupon_code ?? null,
    total: Number(order.total),
    itemCount: items.reduce((sum, row) => sum + Number(row.quantity), 0),
    items: items.map(toItemView),
    customer: {
      name: address.fullName,
      email: order.customer_email,
      phone: order.customer_phone,
    },
    shippingAddress: address,
    delivery: {
      zone: delivery.zone,
      available: delivery.available,
      fee: Number(order.delivery_fee),
      estimatedDelivery: delivery.etaLabel,
      estimatedDeliveryDays: { min: delivery.etaMinDays, max: delivery.etaMaxDays },
    },
    customerNotes: order.customer_notes ?? null,
    payment: toPaymentView(order, payment),
    placedAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

/**
 * A compact order for list surfaces: header plus lines, no payment detail.
 * The `orderNumber` is the lookup key for the full view.
 */
export function toOrderSummary(order, items = []) {
  return {
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.delivery_fee),
    total: Number(order.total),
    itemCount: items.reduce((sum, row) => sum + Number(row.quantity), 0),
    items: items.map(toItemView),
    placedAt: order.created_at,
  };
}

export default { toOrderView, toOrderSummary };
