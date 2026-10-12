/**
 * Review controller — customer-facing submission and eligibility.
 *
 * Thin like every controller in this codebase: read validated input, call one
 * service function, wrap the result in the standard envelope. The identity
 * comes from the session (`req.user`), never from the body; both endpoints are
 * mounted behind `authenticate` in the route file.
 */
import { asyncHandler } from '../utils/async-handler.js';
import { sendSuccess, sendCreated } from '../utils/http-response.js';
import * as service from '../services/review.service.js';

/** `GET /api/v1/reviews/reviewable` — what this customer may review. */
export const listReviewable = asyncHandler(async (req, res) => {
  const result = await service.listReviewableItems(req.db, req.user);
  return sendSuccess(res, { data: { items: result.items } });
});

/** `POST /api/v1/reviews` — submit a review for a delivered purchase. */
export const create = asyncHandler(async (req, res) => {
  const review = await service.createReview(req.db, req.user, req.body);
  return sendCreated(res, { review });
});

export default { listReviewable, create };
