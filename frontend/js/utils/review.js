/**
 * Review helpers.
 *
 * Everything here is pure — no DOM, no network — so the orders page stays a thin
 * layout and the decisions that matter (what a review body looks like, whether a
 * draft is submittable, what an error means) are testable without a browser.
 *
 * The request body is snake_case, matching the backend's `createReviewSchema`: Zod
 * strips anything undeclared, and the server derives the product from the
 * purchased line, so the ONLY thing this helper is allowed to send is the order
 * item id plus the words and stars. There is deliberately no `product_id` field
 * to send: a review is anchored to a purchase, not aimed at a product.
 */

/** The star values a shopper may pick, low to high. */
export const REVIEW_RATING_VALUES = Object.freeze([1, 2, 3, 4, 5]);

/** Trims a value to a string; empty and nullish become "". */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Builds the `POST /reviews` body.
 *
 * `order_item_id` is always sent (the server needs it to prove the purchase).
 * The title and comment are omitted when blank rather than sent as "", because
 * the backend CHECK treats a blank string as text that was provided.
 *
 * @param {{ orderItemId: string, rating: number|string, title?: string, comment?: string }} input
 * @returns {{ order_item_id: string, rating: number, title?: string, comment?: string }}
 */
export function buildReviewBody(input = {}) {
  const body = {
    order_item_id: text(input.orderItemId),
    rating: Math.trunc(Number(input.rating) || 0),
  };

  const title = text(input.title);
  const comment = text(input.comment);
  if (title) body.title = title;
  if (comment) body.comment = comment;

  return body;
}

/**
 * Whether a draft review may be submitted, mirroring the server's rules so the
 * form can disable its button instead of round-tripping to a 422.
 *
 * The two rules are the ones the schema enforces: a whole number of stars from
 * 1 to 5, and at least one of title or comment that is not blank.
 *
 * @param {{ rating?: number|string, title?: string, comment?: string }} draft
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function isReviewSubmittable(draft = {}) {
  const rating = Math.trunc(Number(draft.rating) || 0);
  if (rating < 1 || rating > 5) {
    return { ok: false, reason: 'Pick a star rating from 1 to 5.' };
  }
  if (!text(draft.title) && !text(draft.comment)) {
    return { ok: false, reason: 'Add a few words so your review says something.' };
  }
  return { ok: true, reason: null };
}

/**
 * Groups the reviewable items by the order they came from, so the orders page
 * can show the "write a review" action on the matching order card.
 *
 * An item with no order number lands under the key `''`, which never matches a
 * real order; the page simply will not render it rather than guessing.
 *
 * @param {Array<{ orderNumber?: string }>} items
 * @returns {Map<string, object[]>}
 */
export function groupReviewableByOrder(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = text(item?.orderNumber);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return groups;
}

/**
 * Shopper-facing copy for a failed review submission.
 *
 * @param {{ code?: string, message?: string }|null} error
 * @returns {string}
 */
export function describeReviewError(error) {
  if (!error) return 'Something went wrong sending your review. Please try again.';

  switch (error.code) {
    case 'REVIEW_NOT_ELIGIBLE':
      return 'This item is not yours to review yet. Reviews open once an order is delivered.';
    case 'REVIEW_ALREADY_SUBMITTED':
      return 'You have already reviewed this product for this purchase.';
    case 'VALIDATION_ERROR':
      return 'Please add a star rating and a few words, then try again.';
    case 'UNAUTHORIZED':
      return 'Please sign in again to write a review.';
    case 'NETWORK_ERROR':
      return 'We could not reach the store. Check your connection, then try again.';
    case 'REQUEST_TIMEOUT':
      return 'That took too long. Check your connection, then try again.';
    default:
      return error.message ?? 'Something went wrong sending your review. Please try again.';
  }
}

const REVIEW_STATUS_LABELS = Object.freeze({
  PENDING: 'In review',
  APPROVED: 'Published',
  REJECTED: 'Not published',
});

/** A human label for a review's moderation status. */
export function reviewStatusLabel(status) {
  return REVIEW_STATUS_LABELS[status] ?? 'In review';
}

export default {
  REVIEW_RATING_VALUES,
  buildReviewBody,
  isReviewSubmittable,
  groupReviewableByOrder,
  describeReviewError,
  reviewStatusLabel,
};
