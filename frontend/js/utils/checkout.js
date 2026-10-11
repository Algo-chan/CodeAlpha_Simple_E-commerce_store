/**
 * Checkout helpers.
 *
 * Everything here is pure — no DOM, no network — so the checkout page can stay
 * a thin layout and the decisions that matter (what body the server receives,
 * what a delivery preview costs, what an error actually means) are testable
 * without a browser.
 *
 * The request body is snake_case, matching the backend's `checkoutSchema` and
 * the address book the shopper has already used. The order RESPONSE is
 * camelCase (`order.view.js`), so the two directions are deliberately not
 * symmetric and must not be "tided up" into one shape.
 *
 * MONEY IS INTEGER ETB MINOR UNITS, as everywhere else in the stack.
 */
import { config } from '../config.js';

/** Flat delivery fee, mirroring `DELIVERY.DEFAULT_FEE_MINOR` on the backend. */
export const DELIVERY_DEFAULT_FEE_MINOR = 50_000;

/** Order value at or above which delivery is free. */
export const DELIVERY_FREE_THRESHOLD_MINOR = config.freeShippingThreshold;

/** The only payment method this phase offers. ONLINE is reserved, not built. */
export const PAYMENT_METHOD_COD = 'COD';

/** Trims a value to a string; empty and nullish become "". */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Builds the `POST /checkout` body.
 *
 * Required destination fields are always sent (empty included), so the server's
 * validation error lands on the right field instead of being turned into an
 * opaque "city is required" with no path. Optional fields are omitted when
 * blank rather than sent as "".
 *
 * @param {{
 *   fullName?: string, email?: string, phone?: string, label?: string,
 *   city?: string, area?: string, street?: string, landmark?: string,
 *   additionalNotes?: string, customerNotes?: string,
 *   paymentMethod?: string,
 * }} input
 * @returns {object}
 */
export function buildCheckoutBody(input = {}) {
  const {
    fullName,
    email,
    phone,
    label,
    city,
    area,
    street,
    landmark,
    additionalNotes,
    customerNotes,
    paymentMethod = PAYMENT_METHOD_COD,
  } = input;

  const body = {
    city: text(city),
    area: text(area),
    street: text(street),
    payment_method: paymentMethod,
  };

  const optional = {
    full_name: text(fullName),
    email: text(email),
    phone: text(phone),
    label: text(label),
    landmark: text(landmark),
    additional_notes: text(additionalNotes),
    customer_notes: text(customerNotes),
  };

  for (const [key, value] of Object.entries(optional)) {
    if (value) body[key] = value;
  }

  return body;
}

/**
 * The delivery fee a basket is expected to attract.
 *
 * Mirrors the backend's flat default zone (`delivery.service.js`): free at or
 * above the threshold, otherwise the flat fee. The client shows this as a
 * PREVIEW and the confirmation always uses the server's number, so a future
 * zone tariff can only ever make the preview optimistic for a moment, never
 * wrong on the receipt.
 *
 * @param {number} subtotalMinor
 * @param {{ freeThresholdMinor?: number, defaultFeeMinor?: number }} [options]
 * @returns {{ feeMinor: number, isFree: boolean, remainingForFreeMinor: number }}
 */
export function previewDeliveryFee(subtotalMinor, options = {}) {
  const {
    freeThresholdMinor = DELIVERY_FREE_THRESHOLD_MINOR,
    defaultFeeMinor = DELIVERY_DEFAULT_FEE_MINOR,
  } = options;

  const subtotal = Math.max(0, Math.trunc(Number(subtotalMinor) || 0));
  const isFree = subtotal >= freeThresholdMinor;

  return {
    feeMinor: isFree ? 0 : defaultFeeMinor,
    isFree,
    remainingForFreeMinor: Math.max(0, freeThresholdMinor - subtotal),
  };
}

/**
 * The checkout total: subtotal plus delivery, minus discounts.
 *
 * @param {number} subtotalMinor
 * @param {number} deliveryFeeMinor
 * @param {number} [discountMinor]
 */
export function checkoutTotal(subtotalMinor, deliveryFeeMinor, discountMinor = 0) {
  const value = (n) => Math.trunc(Number(n) || 0);
  return value(subtotalMinor) + value(deliveryFeeMinor) - value(discountMinor);
}

/**
 * Shopper-facing copy for a failed checkout.
 *
 * The API's own message is used when it is specific (a stock count, a
 * deactivated product); the switch covers the cases where the raw message is
 * too terse to act on.
 *
 * @param {{ code?: string, message?: string }|null} error
 * @returns {string}
 */
export function describeCheckoutError(error) {
  if (!error) return 'Something went wrong placing your order. Please try again.';

  switch (error.code) {
    case 'CART_EMPTY':
      return 'There is nothing in your cart to order.';
    case 'PRODUCT_UNAVAILABLE':
      return 'One of your items is no longer available. Remove it and try again.';
    case 'INSUFFICIENT_STOCK':
      return error.message ?? 'One of your items sold out while you were checking out.';
    case 'VALIDATION_ERROR':
      return 'Please check the highlighted fields and try again.';
    case 'SERVICE_UNAVAILABLE':
      return 'We could not place the order just now. Please try again in a moment.';
    case 'NETWORK_ERROR':
      return 'We could not reach the store. Check your connection, then try again.';
    case 'REQUEST_TIMEOUT':
      return 'That took too long. Check your connection, then try again.';
    default:
      return error.message ?? 'Something went wrong placing your order. Please try again.';
  }
}

const ORDER_STATUS_LABELS = Object.freeze({
  PENDING: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being prepared',
  SHIPPED: 'On its way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
});

/** A human label for an order status. */
export function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] ?? 'Processing';
}

/**
 * The feedback tone for an order status, so the badge reads at a glance.
 * @returns {'success'|'warning'|'error'|'info'}
 */
export function orderStatusTone(status) {
  switch (status) {
    case 'DELIVERED':
      return 'success';
    case 'CANCELLED':
      return 'error';
    case 'PENDING':
      return 'warning';
    default:
      return 'info';
  }
}

const PAYMENT_STATUS_LABELS = Object.freeze({
  PENDING: 'Payment due on delivery',
  PAID: 'Paid',
  FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
});

/** A human label for a payment status. */
export function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] ?? 'Payment pending';
}

export default {
  DELIVERY_DEFAULT_FEE_MINOR,
  DELIVERY_FREE_THRESHOLD_MINOR,
  PAYMENT_METHOD_COD,
  buildCheckoutBody,
  previewDeliveryFee,
  checkoutTotal,
  describeCheckoutError,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
};
