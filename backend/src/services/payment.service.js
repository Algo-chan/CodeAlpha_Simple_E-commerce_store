/**
 * Payment service — online payment intents, provider notifications, and the
 * rules that keep order state and payment state from ever disagreeing.
 *
 * Contract with the checkout layer
 *   `checkout.service.js` writes the first PENDING payment row (COD = INTERNAL,
 *   ONLINE = the configured provider). This service then:
 *
 *     1. INITIATE  — `POST /payments` attaches a provider transaction reference
 *                    to the pending intent and returns where to send the
 *                    shopper. Erroring here leaves the order intact and retryable.
 *     2. NOTIFY    — the provider webhook arrives signed over the raw body. The
 *                    signature, reference, amount, currency and order are all
 *                    verified against OUR rows before anything is written.
 *     3. SETTLE    — the payment row moves PENDING → PAID/FAILED and the order's
 *                    `payment_status` follows it atomically. A PAID online order
 *                    is confirmed only now — never from a frontend message.
 *     4. EXPIRE    — stale PENDING intents are failed after a timeout so the
 *                    order does not wait forever for a payment nobody made.
 *
 * Trust boundaries
 *   A frontend can never be the source of truth for "the customer paid": only a
 *   signature-verified notification from the provider settles money. Reference,
 *   amount, currency and order number are all re-read from the database and
 *   compared with what the gateway claims.
 *
 * Refunds are ARCHITECTURE ONLY: the provider contract declares the capability,
 * but no area of this file executes one. Automated refunds wait until a real
 * gateway integration and business rules exist.
 */
import env from '../config/env.js';
import { runInTransaction } from '../utils/transaction.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/app-error.js';
import { ERROR_CODES, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../config/constants.js';
import * as orders from '../repositories/order.repository.js';
import * as payments from '../repositories/payment.repository.js';
import { getActiveOnlineProvider, getProvider } from '../payments/index.js';
import { toPaymentView } from './payment.view.js';

const notFound = () => new AppError('Order not found.', 404, ERROR_CODES.NOT_FOUND);

/**
 * Creates a payment intent for the shopper's own order.
 *
 * Requires the order to belong to the authenticated user (guests cannot init
 * online payment here — they have no account to own the order against), to pay
 * ONLINE, and to not already be settled. A stale PENDING attempt is expired
 * first so success and expiry cannot race.
 *
 * @param {object} db
 * @param {{ userId: string }} context
 * @param {{ order_number: string }} input
 * @returns {Promise<{ payment: object, nextAction: object, sandbox: boolean }>}
 */
export async function initiatePayment(db, context, input) {
  const provider = getActiveOnlineProvider();
  if (!provider) {
    throw new AppError(
      'Online payment is not available at the moment.',
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE
    );
  }

  const order = await orders.findByNumberForUser(db, input.order_number, context.userId);
  if (!order) throw notFound();
  if (order.payment_method !== PAYMENT_METHOD.ONLINE) {
    throw new AppError(
      'This order is paid on delivery, so it does not need an online payment.',
      409,
      ERROR_CODES.PAYMENT_NOT_REQUIRED
    );
  }
  if (order.payment_status === PAYMENT_STATUS.PAID || order.status === ORDER_STATUS.CANCELLED) {
    throw new AppError('This order can no longer be paid.', 409, ERROR_CODES.CONFLICT);
  }

  return runInTransaction(db, async (tx) => {
    // A deposit door left open never gets money for free: expire this order's
    // stale attempts before creating a new one.
    await expireStalePendingTx(tx, { orderId: order.id });

    let payment = await payments.findPendingByOrder(tx, order.id);
    if (!payment) {
      payment = await orders.insertPayment(tx, {
        orderId: order.id,
        provider: provider.name,
        method: PAYMENT_METHOD.ONLINE,
        status: PAYMENT_STATUS.PENDING,
        amount: Number(order.total),
        currency: order.currency,
      });
    }

    const intent = await provider.initializePayment({
      orderNumber: order.order_number,
      amountMinor: Number(order.total),
      currency: order.currency,
      idempotencyKey: payment.id,
    });

    const attached = await payments.attachReference(tx, payment.id, intent.providerReference);

    logger.info('Payment intent created', {
      provider: provider.name,
      orderNumber: order.order_number,
    });

    return {
      payment: toPaymentView(attached, order),
      nextAction: intent.nextAction,
      sandbox: Boolean(intent.sandbox),
    };
  });
}

/**
 * Handles a signed provider notification.
 *
 * @param {object} db
 * @param {{ providerName: string, rawBody: Buffer, headers: object,
 *           payload: object }} input
 * @returns {Promise<{ received: boolean, status: string, duplicate: boolean,
 *                     order?: object }>}
 */
export async function handleWebhook(db, { providerName, rawBody, headers, payload }) {
  const provider = getProvider(providerName);
  if (!provider) {
    throw new AppError('Unknown payment provider.', 404, ERROR_CODES.NOT_FOUND);
  }
  if (!provider.supportsOnline) {
    throw new AppError(
      'This provider does not accept online notifications.',
      400,
      ERROR_CODES.BAD_REQUEST
    );
  }

  provider.verifySignature({ rawBody, headers });

  const event = provider.parseNotification(payload);
  if (!event.providerReference) {
    throw new AppError(
      'The payment notification is missing a transaction reference.',
      422,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  // A gateway reporting progress, not a result, needs no state change yet.
  if (event.status === PAYMENT_STATUS.PENDING) {
    return { received: true, status: PAYMENT_STATUS.PENDING, duplicate: false };
  }

  return runInTransaction(db, async (tx) => {
    const payment = await payments.lockByReference(tx, event.providerReference);
    if (!payment) {
      throw new AppError('Unknown payment transaction.', 404, ERROR_CODES.NOT_FOUND);
    }

    const order = await orders.findById(tx, payment.order_id);
    if (!order) throw notFound();

    provider.verifyNotification(event, { order, payment });

    // Idempotency: a replay of an already-handled result changes nothing. This
    // is also the ordering guarantee — a late FAILED must not overwrite PAID.
    if (payment.status === event.status || payment.status !== PAYMENT_STATUS.PENDING) {
      return { received: true, status: payment.status, duplicate: true };
    }

    const failureReason =
      event.status === PAYMENT_STATUS.FAILED
        ? String(event.failureReason || 'Payment failed.').slice(0, 250)
        : null;
    const settled = await payments.markSettled(tx, payment.id, {
      status: event.status,
      failureReason,
      paidAt: event.status === PAYMENT_STATUS.PAID ? new Date() : null,
    });

    if (!settled) {
      return { received: true, status: payment.status, duplicate: true };
    }

    const orderUpdate = { paymentStatus: event.status };
    if (event.status === PAYMENT_STATUS.PAID && order.status === ORDER_STATUS.PENDING) {
      orderUpdate.status = ORDER_STATUS.CONFIRMED;
    }
    const updatedOrder = await orders.updateOrderState(tx, order.id, orderUpdate);

    logger.info('Payment notification settled', {
      provider: provider.name,
      orderNumber: order.order_number,
      status: event.status,
    });

    return {
      received: true,
      status: event.status,
      duplicate: false,
      order: {
        orderNumber: order.order_number,
        status: updatedOrder.status,
        paymentStatus: updatedOrder.payment_status,
      },
    };
  });
}

/**
 * Fails online payment attempts that have sat PENDING past the configured
 * timeout. A timed-out order stays retryable; a later real notification is
 * still honoured once a fresh intent exists.
 *
 * Public so an operator (or a scheduled job later) can call it directly.
 *
 * @param {object} db
 * @param {{ orderId?: string|null, timeoutMinutes?: number, now?: Date }} [options]
 * @returns {Promise<number>} how many attempts were expired
 */
export async function expireStalePending(
  db,
  { orderId = null, timeoutMinutes = env.PAYMENT_PENDING_TIMEOUT_MINUTES, now = new Date() } = {}
) {
  return runInTransaction(db, (tx) => expireStalePendingTx(tx, { orderId, timeoutMinutes, now }));
}

/** Transaction-scoped expiry used by both `expireStalePending` and init. */
async function expireStalePendingTx(
  tx,
  { orderId = null, timeoutMinutes = env.PAYMENT_PENDING_TIMEOUT_MINUTES, now = new Date() } = {}
) {
  const cutoff = new Date(now.getTime() - timeoutMinutes * 60_000);
  const expired = await payments.expirePendingBefore(tx, cutoff, { orderId });

  for (const row of expired) {
    await orders.updateOrderState(tx, row.order_id, { paymentStatus: PAYMENT_STATUS.FAILED });
  }

  if (expired.length > 0) {
    logger.warn('Expired pending online payments', { count: expired.length });
  }
  return expired ? expired.length : 0;
}

/**
 * Refund architecture. The provider contract declares whether a refund is even
 * conceivable; executing one is deliberately disabled until a real gateway
 * integration and business rules exist.
 */
export async function refundPayment(_db, { providerName }) {
  const provider = getProvider(providerName);
  if (!provider) {
    throw new AppError('Unknown payment provider.', 404, ERROR_CODES.NOT_FOUND);
  }
  if (!provider.supportsRefunds) {
    throw new AppError(
      `${provider.name} does not support automated refunds in this phase.`,
      501,
      ERROR_CODES.NOT_IMPLEMENTED
    );
  }
  return provider.refund?.() ?? null;
}

export default { initiatePayment, handleWebhook, expireStalePending, refundPayment };
