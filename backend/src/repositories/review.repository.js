/**
 * Review repository — approved reviews for the product detail page.
 *
 * VERIFIED PURCHASE IS DERIVED, NEVER STORED
 *
 * There is no `is_verified` column and there should not be one. The schema makes
 * the fact checkable instead: `reviews.order_item_id` is NOT NULL and points at a
 * real purchased line, so "verified" means "this review points at a line that
 * belongs to the reviewer, for this product, on a delivered order".
 *
 * A client cannot influence any of that. It cannot post a review at all yet
 * (review creation belongs to the account phase), and if it could, the predicate
 * below would still be the only thing that decides the badge — a client-supplied
 * `verified: true` would have nowhere to go.
 *
 * PRIVACY
 *
 * Only `users.name` is selected. `email`, `phone` and `password_hash` are never
 * read here, so no amount of serialisation can leak them.
 */
import { query as poolQuery } from '../config/db.js';

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

export default { listProductReviews, getRatingSummary };
