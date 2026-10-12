/**
 * Review service — the rules that turn a rating into an anchored review.
 *
 * Every rule here exists because accepting a bare `{ rating, text }` would let a
 * stranger review any product. A review must be EARNED: it has to point at a
 * real purchased line (`order_item_id`), that line must belong to the signed-in
 * reviewer, and the order must be DELIVERED. Only then does the review become
 * real — and because it is anchored to the purchase, "verified purchase" is a
 * fact of the schema rather than a badge someone decided to add.
 *
 * A submitted review is always PENDING moderation. The customer gets a success
 * response; the storefront does not republish it until an administrator
 * approves it.
 *
 * Every function here returns plain objects from validated input and a
 * database executor, so it is testable against PGlite with no server running.
 */
import { AppError } from '../utils/app-error.js';
import { ERROR_CODES } from '../config/constants.js';
import * as reviews from '../repositories/review.repository.js';
import { toReview, toReviewableItem, buildVariantLabel } from './catalogue.view.js';

/** The line does not qualify — not yours, not delivered, or a guest order. */
export function notEligible(message) {
  return new AppError(
    message ?? 'This item is not yours to review yet.',
    422,
    ERROR_CODES.REVIEW_NOT_ELIGIBLE
  );
}

/** This customer (or this purchase) has already been counted once. */
export function alreadySubmitted() {
  return new AppError(
    'You have already reviewed this product for this purchase.',
    409,
    ERROR_CODES.REVIEW_ALREADY_SUBMITTED
  );
}

/**
 * What a signed-in customer may review, newest purchase first.
 *
 * @param {object} db
 * @param {object} user the authenticated user
 * @returns {Promise<{ items: object[] }>}
 */
export async function listReviewableItems(db, user) {
  const rows = await reviews.listReviewableItems(db, user.id);
  return { items: rows.map(toReviewableItem) };
}

/**
 * Submits a review for a purchased, delivered order item.
 *
 * The client supplies the order item and the words; the product is derived from
 * the purchase so the review can never be aimed at a product the customer did
 * not buy. Duplicate guards (one per purchase line, one per product per
 * customer) are checked before insert so the failure reads as a 409, not a
 * database error.
 *
 * @param {object} db
 * @param {object} user the authenticated user
 * @param {{ orderItemId: string, rating: number, title?: string, comment?: string }} input
 * @returns {Promise<object>} the review, PENDING
 */
export async function createReview(db, user, input) {
  const line = await reviews.findEligibleOrderItem(db, input.order_item_id, user.id);
  if (!line) throw notEligible();

  if (await reviews.findReviewByOrderItem(db, input.order_item_id)) throw alreadySubmitted();
  if (await reviews.findReviewByUserAndProduct(db, user.id, line.product_id)) {
    throw alreadySubmitted();
  }

  const created = await reviews.insertReview(db, {
    userId: user.id,
    productId: line.product_id,
    orderItemId: line.order_item_id ?? line.id,
    rating: input.rating,
    title: input.title ?? null,
    comment: input.comment ?? null,
  });

  return {
    ...toReview({
      id: created.id,
      rating: created.rating,
      title: created.title,
      comment: created.comment,
      reviewer_name: user.name,
      is_verified_purchase: true,
      status: created.status,
      created_at: created.created_at,
    }),
    product: { id: String(line.product_id), name: line.product_name, slug: line.product_slug },
    variantLabel: buildVariantLabel(line.variant_attributes),
  };
}

export default { listReviewableItems, createReview, notEligible, alreadySubmitted };
