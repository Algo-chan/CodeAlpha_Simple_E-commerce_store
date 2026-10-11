/**
 * Cash-on-delivery provider.
 *
 * COD is not an online gateway: there is no redirect, no signed callback, and
 * the money moves when the courier collects. It is modelled as a provider all
 * the same, so the payment service can treat every method uniformly and the
 * store's own payment record has an honest `provider` value (INTERNAL).
 *
 * Every online-only method throws a clear 501 rather than pretending to work.
 */
import { ERROR_CODES, PAYMENT_PROVIDER } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

const notOnline = () =>
  new AppError(
    'Cash on delivery does not use an online payment gateway.',
    501,
    ERROR_CODES.NOT_IMPLEMENTED
  );

export const codProvider = {
  name: PAYMENT_PROVIDER.INTERNAL,
  /** COD is settled offline; it never drives an ONLINE payment. */
  supportsOnline: false,
  supportsRefunds: false,

  /** @returns {never} */
  initializePayment() {
    throw notOnline();
  },

  /** @returns {never} COD has no notifications to verify. */
  verifySignature() {
    throw notOnline();
  },

  /** @returns {never} */
  parseNotification() {
    throw notOnline();
  },

  /** @returns {never} */
  verifyNotification() {
    throw notOnline();
  },

  /** @returns {never} */
  refund() {
    throw new AppError(
      'Cash on delivery is settled in person and is not refunded through a gateway.',
      501,
      ERROR_CODES.NOT_IMPLEMENTED
    );
  },
};

export default codProvider;
