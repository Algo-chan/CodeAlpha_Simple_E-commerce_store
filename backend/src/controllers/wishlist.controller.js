/**
 * Wishlist controller.
 *
 * `authenticate` has already resolved the shopper from the session cookie,
 * so `req.user.id` is the only identity ever used — a body-supplied user id
 * has nowhere to go.
 */
import { asyncHandler } from '../utils/async-handler.js';
import { sendSuccess } from '../utils/http-response.js';
import * as service from '../services/wishlist.service.js';

/** `GET /api/v1/wishlist` */
export const getWishlist = asyncHandler(async (req, res) => {
  sendSuccess(res, { data: { wishlist: await service.getWishlist(req.db, req.user.id) } });
});

/** `POST /api/v1/wishlist/items` */
export const addItem = asyncHandler(async (req, res) => {
  const wishlist = await service.addItem(req.db, req.user.id, req.body.productId);
  sendSuccess(res, { data: { wishlist } });
});

/** `DELETE /api/v1/wishlist/items/:productId` */
export const removeItem = asyncHandler(async (req, res) => {
  const wishlist = await service.removeItem(req.db, req.user.id, req.params.productId);
  sendSuccess(res, { data: { wishlist } });
});

/** `POST /api/v1/wishlist/merge` — folds the guest's local list into ours. */
export const merge = asyncHandler(async (req, res) => {
  const wishlist = await service.merge(req.db, req.user.id, req.body.productIds);
  sendSuccess(res, { data: { wishlist } });
});

export default { getWishlist, addItem, removeItem, merge };
