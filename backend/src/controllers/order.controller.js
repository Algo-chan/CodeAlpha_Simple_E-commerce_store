/**
 * Order controller — HTTP in, HTTP out for a customer's order history.
 *
 * Both endpoints sit behind `authenticate`, so `req.user.id` is the only
 * ownership key. The service scopes every query by it, which is why this file
 * contains no authorization branch: there is no path here that can reach
 * another customer's order.
 */
import { asyncHandler } from '../utils/async-handler.js';
import { sendSuccess } from '../utils/http-response.js';
import * as service from '../services/order.service.js';

/** `GET /api/v1/orders` */
export const list = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery ?? req.query;
  const result = await service.listOrders(req.db, req.user.id, { page, limit });

  return sendSuccess(res, {
    data: { orders: result.orders },
    meta: { pagination: result.pagination },
  });
});

/** `GET /api/v1/orders/:orderNumber` */
export const getOne = asyncHandler(async (req, res) => {
  const order = await service.getOrder(req.db, req.user.id, req.params.orderNumber);
  return sendSuccess(res, { data: { order } });
});

export default { list, getOne };
