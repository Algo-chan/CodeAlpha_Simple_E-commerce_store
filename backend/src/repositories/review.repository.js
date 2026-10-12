/**
 * Review repository — reading and writing product reviews.
 *
 * VERIFIED PURCHASE IS DERIVED, NEVER STORED
 *
 * There is no `is_verified` column and there should not be one. The schema makes
 * the fact checkable instead: `reviews.order_item_id` is NOT NULL and points at a
 * real purchased line, so "verified" means "this review points at a line that
 * belongs to the reviewer, for this product, on a delivered order".
 *
 * A client cannot influence any of that. Neither the write nor the read path
 * accepts a `verified` flag: `createReview` accepts an `order_item_id` and the
 * server derives the product and proves the purchase (see
 * `findEligibleOrderItem`), so the same predicate that brands a review as
 * verified is the predicate that must be true before the review exists at all.
 *
 * PRIVACY
 *
 * Only `users.name` is selected. `email`, `phone` and `password_hash` are never
 * read here, so no amount of serialisation can leak them.
 */
import { query as poolQuery } from '../config/db.js';

/** The executor to use: a request/tx-scoped one when given, else the pool. */
function executor(db) {
  return db?.query ?? poolQuery;
}

/**
 * Loads approved reviews for a product, newest first.
 *
 * @param {string} productId
 * @param {{ limit?: number, offset?: number }} [options]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listProductReviews(productId, options = {}, db = {}) {
  const execute = db.query ?? poolQuery;
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 50);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const result = await execute(
    `SELECT
       r.id,
       r.rating,
       r.title,
       r.comment,
       r.created_at,
       u.name AS reviewer_name,
       (
         o.status = 'DELIVERED'
         AND o.user_id = r.user_id
         AND oi.product_id = r.product_id
       ) AS is_verified_purchase,
       -- The unpaginated total rides along with the page so the count costs no
       -- second query and cannot disagree with the rows beside it.
       count(*) OVER ()::int AS total_count
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     JOIN order_items oi ON oi.id = r.order_item_id
     JOIN orders o ON o.id = oi.order_id
     WHERE r.product_id = $1 AND r.status = 'APPROVED'
     ORDER BY r.created_at DESC, r.id
     LIMIT $2 OFFSET $3`,
    [productId, limit, offset]
  );

  return { rows: result.rows, total: Number(result.rows[0]?.total_count ?? 0) };
}

/**
 * Rating summary for a product: average, count and the 5-to-1 distribution.
 *
 * `generate_series` supplies the five buckets so a product with no 1-star
 * reviews reports a zero row rather than a missing one. A distribution bar chart
 * that silently omits an empty bucket renders wrong widths, which reads as a
 * data error to the shopper.
 *
 * Only APPROVED reviews count: a PENDING review has not been published and a
 * REJECTED one must never influence a rating.
 *
 * @param {string} productId
 * @param {{ query?: Function }} [db]
 * @returns {Promise<{ average: number|null, count: number, distribution: object[] }>}
 */
export async function getRatingSummary(productId, db = {}) {
  const execute = db.query ?? poolQuery;

  const aggregateResult = await execute(
    `SELECT round(avg(r.rating)::numeric, 1) AS average, count(*)::int AS total
       FROM reviews r
      WHERE r.product_id = $1 AND r.status = 'APPROVED'`,
    [productId]
  );

  const distributionResult = await execute(
    `SELECT s.stars::int AS stars, count(r.id)::int AS count
       FROM generate_series(1, 5) AS s(stars)
       LEFT JOIN reviews r
         ON r.product_id = $1 AND r.status = 'APPROVED' AND r.rating = s.stars
      GROUP BY s.stars
      ORDER BY s.stars DESC`,
    [productId]
  );

  const aggregate = aggregateResult.rows[0] ?? {};
  const total = Number(aggregate.total ?? 0);

  return {
    average: total > 0 && aggregate.average !== null ? Number(aggregate.average) : null,
    count: total,
    distribution: distributionResult.rows.map((row) => ({
      stars: Number(row.stars),
      count: Number(row.count),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Writing — the customer submits, the server proves the purchase.              */
/* -------------------------------------------------------------------------- */

/**
 * The order item a review may be attached to, or null.
 *
 * The canonical eligibility predicate from migration 017: the line belongs to
 * the signed-in reviewer (`orders.user_id`), it sits in a DELIVERED order, and
 * it really is a purchased line `order_items`. A guest order has `user_id`
 * NULL, so it can never qualify.
 *
 * The product is DERIVED here, never accepted from the client: the review is
 * anchored to the order item, and the product is whatever that line says. That
 * is what makes "verified purchase" a fact with nowhere to lie.
 *
 * @param {object} db transaction executor
 * @param {string} orderItemId the purchase line being reviewed
 * @param {string} userId the signed-in reviewer
 * @returns {Promise<object|null>}
 */
export async function findEligibleOrderItem(db, orderItemId, userId) {
  const result = await executor(db)(
    `SELECT
       oi.id,
       oi.product_id,
       oi.variant_id,
       oi.variant_attributes,
       o.id AS order_id,
       o.order_number,
       o.created_at,
       p.name AS product_name,
       p.slug AS product_slug
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE oi.id = $1
       AND o.user_id = $2
       AND o.status = 'DELIVERED'`,
    [orderItemId, userId]
  );
  return result.rows[0] ?? null;
}

/** A review already anchored to this exact purchase line, if any. */
export async function findReviewByOrderItem(db, orderItemId) {
  const result = await executor(db)(`SELECT id FROM reviews WHERE order_item_id = $1`, [
    orderItemId,
  ]);
  return result.rows[0] ?? null;
}

/** A review already written by this customer for this product, if any. */
export async function findReviewByUserAndProduct(db, userId, productId) {
  const result = await executor(db)(
    `SELECT id, status FROM reviews WHERE user_id = $1 AND product_id = $2`,
    [userId, productId]
  );
  return result.rows[0] ?? null;
}

/**
 * Inserts a customer review, always PENDING moderation.
 *
 * The constraints in migration 017 (one per order item, one per user per
 * product, rating 1–5, some text) are the last line of defence; the service
 * checks each one first so a shopper gets a clear message rather than a
 * translated database error.
 *
 * @param {object} db transaction executor
 * @param {{ userId: string, productId: string, orderItemId: string,
 *           rating: number, title?: string|null, comment?: string|null }} input
 * @returns {Promise<object>} the inserted row
 */
export async function insertReview(db, input) {
  const result = await executor(db)(
    `INSERT INTO reviews (user_id, product_id, order_item_id, rating, title, comment, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
     RETURNING id, user_id, product_id, order_item_id, rating, title, comment, status,
               created_at, updated_at`,
    [
      input.userId,
      input.productId,
      input.orderItemId,
      input.rating,
      input.title ?? null,
      input.comment ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

/**
 * The customer's own reviewable purchases: delivered order items for a product
 * they have not already reviewed, and that have not been reviewed before.
 *
 * Both duplicate guards matter. `UNIQUE (order_item_id)` means a given purchase
 * line can be reviewed once; `UNIQUE (user_id, product_id)` means a product
 * bought again in a later order is not reviewable a second time. An item that
 * fails either check is excluded here so the storefront never offers a "Write a
 * review" action the server would refuse.
 *
 * @param {object} db
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listReviewableItems(db, userId) {
  const result = await executor(db)(
    `SELECT
       oi.id,
       oi.product_id,
       oi.variant_id,
       oi.variant_attributes,
       o.order_number,
       o.created_at,
       p.name AS product_name,
       p.slug AS product_slug
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN reviews existing_by_item ON existing_by_item.order_item_id = oi.id
     LEFT JOIN reviews existing_by_user
       ON existing_by_user.user_id = $1 AND existing_by_user.product_id = oi.product_id
     WHERE o.user_id = $1
       AND o.status = 'DELIVERED'
       AND existing_by_item.id IS NULL
       AND existing_by_user.id IS NULL
     ORDER BY o.created_at DESC, oi.id`,
    [userId]
  );
  return result.rows;
}

export default {
  listProductReviews,
  getRatingSummary,
  findEligibleOrderItem,
  findReviewByOrderItem,
  findReviewByUserAndProduct,
  insertReview,
  listReviewableItems,
};
