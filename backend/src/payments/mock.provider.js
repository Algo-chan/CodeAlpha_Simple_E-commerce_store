/**
 * Sandbox online provider.
 *
 * No real gateway credentials exist in this phase, so this adapter implements
 * the full ONLINE contract against a simulation: it issues a provider reference
 * and a redirect target, and it signs and verifies notifications exactly the
 * way a real gateway would. Swapping in TeleBirr or Stripe means adding a
 * sibling file with the same shape — the payment service never learns the
 * difference.
 *
 * The signing secret is read from the environment. In non-production the
 * adapter falls back to a well-known development value so a fresh checkout
 * works before secrets are provisioned; in production `env.js` refuses to boot
 * without a real one.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import {
  ERROR_CODES,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
} from '../config/constants.js';
import { AppError } from '../utils/app-error.js';
import { verifySignature as verifySignedMessage } from './signature.js';

/** Development-only fallback; replaced by PAYMENT_WEBHOOK_SECRET in production. */
export const MOCK_SANDBOX_SECRET = 'mock-sandbox-webhook-secret';

const PAID_EVENTS = new Set(['PAID', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'SETTLED']);
const FAILED_EVENTS = new Set(['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED']);

/** Maps a gateway status onto the store's four canonical payment states. */
export function normaliseStatus(status) {
  const value = String(status ?? '').toUpperCase();
  if (PAID_EVENTS.has(value)) return PAYMENT_STATUS.PAID;
  if (FAILED_EVENTS.has(value)) return PAYMENT_STATUS.FAILED;
  return PAYMENT_STATUS.PENDING;
}

function secret() {
  return env.PAYMENT_WEBHOOK_SECRET || MOCK_SANDBOX_SECRET;
}

function failure(message, details) {
  return new AppError(message, 422, ERROR_CODES.VALIDATION_ERROR, details);
}

export const mockProvider = {
  name: PAYMENT_PROVIDER.MOCK,
  supportsOnline: true,
  /** Declared, but deliberately not executed in this phase (architecture only). */
  supportsRefunds: false,

  /**
   * Creates a payment intent for an order.
   *
   * @param {{ orderNumber: string, amountMinor: number, currency: string }} request
   * @returns {{ providerReference: string, status: string,
   *             nextAction: { type: string, url: string }, sandbox: boolean }}
   */
  initializePayment({ orderNumber }) {
    const providerReference = `MOCK-${crypto.randomUUID()}`;
    const url = new URL(env.PAYMENT_MOCK_CHECKOUT_URL);
    url.searchParams.set('reference', providerReference);
    url.searchParams.set('order', orderNumber);
    return {
      providerReference,
      status: PAYMENT_STATUS.PENDING,
      nextAction: { type: 'redirect', url: url.toString() },
      sandbox: true,
    };
  },

  /**
   * Verifies the `x-payment-signature` / `x-payment-timestamp` headers against
   * the raw request body. Throws a 401 rather than returning false so a caller
   * cannot forget to check.
   */
  verifySignature({ rawBody, headers }) {
    const valid = verifySignedMessage({
      secret: secret(),
      rawBody,
      signature: headers['x-payment-signature'],
      timestamp: headers['x-payment-timestamp'],
      toleranceSeconds: env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
    });

    if (!valid) {
      throw new AppError(
        'The payment notification signature is invalid.',
        401,
        ERROR_CODES.UNAUTHORIZED
      );
    }
  },

  /**
   * Turns a provider payload into the store's normalised event. Numbers are
   * coerced here so the service compares integers, never strings.
   */
  parseNotification(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const amount = source.amount_minor ?? source.amountMinor ?? source.amount;
    return {
      providerReference: source.reference ?? source.transaction_reference ?? null,
      status: normaliseStatus(source.status),
      amountMinor: amount === undefined || amount === null ? null : Math.trunc(Number(amount)),
      currency: source.currency ? String(source.currency).toUpperCase() : null,
      orderNumber: source.order_number ?? source.orderNumber ?? null,
      failureReason: source.failure_reason ?? source.failureReason ?? null,
    };
  },

  /**
   * Cross-checks a notification against what was actually ordered. The store's
   * own rows are the authority: the gateway's claimed amount and currency must
   * match them, or the notification is refused.
   *
   * @param {{ amountMinor: number|null, currency: string|null }} event
   * @param {{ order: object, payment: object }} context
   */
  verifyNotification(event, { order, payment }) {
    if (payment.provider !== this.name || payment.method !== PAYMENT_METHOD.ONLINE) {
      throw failure('This payment does not belong to the online gateway that reported it.');
    }

    if (event.currency && order.currency && event.currency !== order.currency) {
      throw failure('The payment currency does not match the order.', {
        expected: order.currency,
        received: event.currency,
      });
    }

    if (Number.isFinite(event.amountMinor) && event.amountMinor !== Number(order.total)) {
      throw failure('The paid amount does not match the order total.', {
        expected: Number(order.total),
        received: event.amountMinor,
      });
    }
  },

  /** @returns {never} Refunds are architecture-only in this phase. */
  refund() {
    throw new AppError('Automated refunds are not enabled yet.', 501, ERROR_CODES.NOT_IMPLEMENTED);
  },
};

export default mockProvider;
