/**
 * Coupon service — the pricing rules a discount code must satisfy.
 *
 * ONE EVALUATOR, TWO CALLERS.
 *   `evaluate` is pure: given a coupon row, the cart subtotal, the customer and
 *   how many times that customer has already used the coupon, it returns the
 *   discount in minor units or throws. The preview endpoint calls it read-only;
 *   checkout calls it again under a row lock before redeeming. Because both go
 *   through the same function, a code that previews as valid cannot become
 *   invalid between preview and purchase except for a genuine race, which the
 *   lock then catches.
 *
 * DISCOUNTS ARE CLAMPED TO THE SUBTOTAL.
 *   A FIXED code larger than the cart discounts the cart to zero, never below.
 *   A PERCENT code can never exceed 100% by construction; its optional cap is
 *   applied on top of the percentage. The result is always >= 0 and <= subtotal,
 *   which is exactly what `orders_discount_not_above_subtotal` requires.
 *
 * USAGE IS COUNTED, NOT GUESSED.
 *   `max_uses` is checked against the coupon's own `used_count`; `per_user_limit`
 *   against the number of non-cancelled orders this customer has with the coupon.
 *   Both checks live here so a change to the rule is a change in one place.
 */
import { AppError } from '../utils/app-error.js';
import { COUPON_TYPE, ERROR_CODES } from '../config/constants.js';
import * as coupons from '../repositories/coupon.repository.js';

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Every rejection is the same public code; only the sentence differs. */
function invalid(message, details) {
  return new AppError(message, 422, ERROR_CODES.COUPON_INVALID, details);
}

/** Minor units as a display string. Presentation only — never fed back into maths. */
function birr(minor) {
  return `${(Number(minor) / 100).toFixed(2)} ETB`;
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The discount a coupon awards on a given subtotal, clamped to [0, subtotal].
 *
 * @param {{ discount_type: string, discount_value: number|string, max_discount: number|string|null }} coupon
 * @param {number} subtotalMinor
 * @returns {number} discount in minor units
 */
export function computeDiscount(coupon, subtotalMinor) {
  const value = Number(coupon.discount_value);
  const subtotal = Number(subtotalMinor);

  if (coupon.discount_type === COUPON_TYPE.PERCENT) {
    // Integer percentage, floored once. BigInt keeps the multiply exact even for
    // a very large cart.
    let award = Number((BigInt(subtotal) * BigInt(value)) / 100n);
    if (coupon.max_discount !== null && coupon.max_discount !== undefined) {
      award = Math.min(award, Number(coupon.max_discount));
    }
    return Math.min(award, subtotal);
  }

  // FIXED: never more than the subtotal itself.
  return Math.min(value, subtotal);
}

/**
 * Validates a coupon against a cart and returns its award.
 *
 * @param {object|null} coupon a coupon row (already fetched), or null if the code did not resolve
 * @param {{ subtotalMinor: number, userId: string|null, userRedemptions?: number, now?: Date }} context
 * @returns {{ coupon: object, discountMinor: number }}
 */
export function evaluate(coupon, { subtotalMinor, userId, userRedemptions = 0, now = new Date() }) {
  if (!coupon) throw invalid("That coupon code isn't valid.");
  if (coupon.is_active !== true) throw invalid('That coupon is no longer available.');

  const from = coupon.valid_from ? new Date(coupon.valid_from) : null;
  const until = coupon.valid_until ? new Date(coupon.valid_until) : null;
  if (from && now < from) throw invalid('That coupon is not active yet.');
  if (until && now > until) throw invalid('That coupon has expired.');

  if (coupon.max_uses !== null && coupon.max_uses !== undefined) {
    if (Number(coupon.used_count) >= Number(coupon.max_uses)) {
      throw invalid('That coupon has reached its usage limit.');
    }
  }

  if (userId && coupon.per_user_limit !== null && coupon.per_user_limit !== undefined) {
    if (Number(userRedemptions) >= Number(coupon.per_user_limit)) {
      throw invalid("You've already used that coupon the maximum number of times.");
    }
  }

  const minimum = Number(coupon.min_subtotal ?? 0);
  if (subtotalMinor < minimum) {
    throw invalid(`Add ${birr(minimum - subtotalMinor)} more to your cart to use that coupon.`, {
      min_subtotal: minimum,
      subtotal: subtotalMinor,
    });
  }

  return { coupon, discountMinor: computeDiscount(coupon, subtotalMinor) };
}

/* -------------------------------------------------------------------------- */
/* Shopper entry points                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Read-only preview of a code against the current cart. Never writes and never
 * locks — a shopper may try many codes before choosing one.
 *
 * @param {object} db
 * @param {{ code: string, subtotalMinor: number, userId?: string|null }} input
 */
export async function preview(db, { code, subtotalMinor, userId = null }) {
  const trimmed = String(code ?? '').trim();
  if (trimmed === '') throw invalid('Enter a coupon code.');
  if (Number(subtotalMinor) <= 0) throw invalid('Add items to your cart before applying a coupon.');

  const coupon = await coupons.findByCode(db, trimmed);
  const redemptions =
    coupon && userId ? await coupons.countUserRedemptions(db, coupon.id, userId) : 0;
  const { discountMinor } = evaluate(coupon, {
    subtotalMinor,
    userId,
    userRedemptions: redemptions,
  });

  return { code: coupon.code, discountMinor };
}

/**
 * Locks a code, re-validates it against the cart and spends one use. Called
 * inside the checkout transaction only.
 *
 * @param {object} tx transaction executor
 * @param {{ code: string, subtotalMinor: number, userId?: string|null }} input
 * @returns {Promise<{ couponId: string, couponCode: string, discountMinor: number }>}
 */
export async function redeem(tx, { code, subtotalMinor, userId = null }) {
  const coupon = await coupons.findByCode(tx, code, { forUpdate: true });
  const redemptions =
    coupon && userId ? await coupons.countUserRedemptions(tx, coupon.id, userId) : 0;

  const { discountMinor } = evaluate(coupon, {
    subtotalMinor,
    userId,
    userRedemptions: redemptions,
  });

  await coupons.redeem(tx, coupon.id);

  return { couponId: coupon.id, couponCode: coupon.code, discountMinor };
}

export default { computeDiscount, evaluate, preview, redeem };
