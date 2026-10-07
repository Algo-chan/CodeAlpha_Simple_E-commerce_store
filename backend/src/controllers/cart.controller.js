/**
 * Cart controller — HTTP in, HTTP out for the cart API.
 *
 * Identity never comes from the body: `authenticateIfPresent` resolved the
 * session cookie (if any) and the rest of the cart identity is the httpOnly
 * guest cart cookie. The only controller-level side effect is issuing or
 * clearing that cookie; everything else is a pass-through to the service so
 * the envelope stays uniform.
 */
import env from '../config/env.js';
import { CART_COOKIE_NAME, GUEST_CART_MAX_AGE_SECONDS } from '../config/constants.js';
import { asyncHandler } from '../utils/async-handler.js';
import { serializeCookie, clearCookie, readCookie } from '../utils/cookies.js';
import { sendSuccess } from '../utils/http-response.js';
import * as service from '../services/cart.service.js';

/** Identity for the cart layer: session user (trusted) or guest cookie token. */
function cartContext(req) {
  return {
    userId: req.user?.id ?? null,
    guestToken: readCookie(req, CART_COOKIE_NAME),
  };
}

/** Applies the service's cookie decision: issue a new token or retire one. */
function applyCookie(res, cookie) {
  if (!cookie) return;
  if (cookie.issue) {
    res.append(
      'Set-Cookie',
      serializeCookie(CART_COOKIE_NAME, cookie.issue, {
        maxAgeSeconds: GUEST_CART_MAX_AGE_SECONDS,
        isSecure: env.isProduction,
      })
    );
  } else if (cookie.clear) {
    clearCookie(res, CART_COOKIE_NAME);
  }
}

function sendCart(res, result) {
  applyCookie(res, result.cookie);
  sendSuccess(res, { data: { cart: result.cart, merged: result.merged } });
}

/** `GET /api/v1/cart` */
export const getCart = asyncHandler(async (req, res) => {
  sendCart(res, await service.getCart(req.db, cartContext(req)));
});

/** `POST /api/v1/cart/items` */
export const addItem = asyncHandler(async (req, res) => {
  const { variantId, quantity } = req.body;
  sendCart(res, await service.addItem(req.db, cartContext(req), { variantId, quantity }));
});

/** `PATCH /api/v1/cart/items/:id` */
export const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  sendCart(res, await service.updateItem(req.db, cartContext(req), req.params.id, { quantity }));
});

/** `DELETE /api/v1/cart/items/:id` */
export const removeItem = asyncHandler(async (req, res) => {
  sendCart(res, await service.removeItem(req.db, cartContext(req), req.params.id));
});

/** `DELETE /api/v1/cart` — empties the basket, keeps the cart identity. */
export const clearCart = asyncHandler(async (req, res) => {
  sendCart(res, await service.clearCart(req.db, cartContext(req)));
});

export default { getCart, addItem, updateItem, removeItem, clearCart };
