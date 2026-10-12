/**
 * Checkout controller — HTTP in, HTTP out for placing an order.
 *
 * The cart identity is exactly the cart layer's: the session user (trusted,
 * resolved by `authenticateIfPresent`) plus the httpOnly guest cart cookie. The
 * body carries fulfilment details only; prices, totals, statuses and the owning
 * user are all computed inside the checkout transaction, never read from the
 * request.
 *
 * A successful checkout is a 201 with the finished order — the confirmation
 * payload. The cart cookie is untouched: the cart and its identity outlive the
 * order so the next visit starts from an empty basket rather than a new guest.
 */
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendSuccess } from '../utils/http-response.js';
import { readCookie } from '../utils/cookies.js';
import { CART_COOKIE_NAME } from '../config/constants.js';
import * as service from '../services/checkout.service.js';
import * as cartService from '../services/cart.service.js';
import * as couponService from '../services/coupon.service.js';

/** Identity for checkout: the session user (trusted) or guest cart cookie. */
function checkoutContext(req) {
  return {
    userId: req.user?.id ?? null,
    guestToken: readCookie(req, CART_COOKIE_NAME),
  };
}

/** `POST /api/v1/checkout` */
export const create = asyncHandler(async (req, res) => {
  const result = await service.checkout(req.db, checkoutContext(req), req.body, {
    user: req.user ?? null,
  });

  return sendCreated(res, { order: result.order }, 'Order placed successfully.');
});

/**
 * `POST /api/v1/checkout/coupon`
 *
 * Prices a code against the caller's current cart. The subtotal is read from the
 * cart service (server-side, same identity rules as checkout) so the client can
 * never tell the server what the cart is worth. Nothing is written.
 */
export const previewCoupon = asyncHandler(async (req, res) => {
  const { cart } = await cartService.getCart(req.db, checkoutContext(req));
  const result = await couponService.preview(req.db, {
    code: req.body.code,
    subtotalMinor: cart.subtotal,
    userId: req.user?.id ?? null,
  });

  return sendSuccess(res, {
    data: { coupon: { code: result.code, discount: result.discountMinor } },
  });
});

export default { create, previewCoupon };
