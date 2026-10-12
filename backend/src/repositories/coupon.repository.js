/**
 * Coupon repository — the only place allowed to run coupon SQL.
 *
 * REDEMPTION IS A WRITE ON THE COUPON ROW, UNDER LOCK.
 *   `findByCode(..., { forUpdate: true })` takes a row lock so that usage limits
 *   are decided against a snapshot nobody else can move until the checkout
 *   transaction commits. `redeem` then increments `used_count` in that same
 *   transaction, so two concurrent checkouts cannot both spend the last use.
 *
 * CODES ARE NORMALISED AT THE EDGE.
 *   The database stores codes upper-cased and space-free (migration 023). Every
 *   lookup normalises the input the same way, so "saver10", "SAVER10" and
 *   " save10 " all resolve to the same row without a case-insensitive scan.
 *
 * ORDERS REMEMBER THEIR COUPON.
 *   The checkout stamps `orders.coupon_id` and `orders.coupon_code`. The id is
 *   the link used for reporting and per-user counts; the code snapshot is what a
 *   receipt shows after the coupon is edited or deleted.
 */
import { query as poolQuery } from '../config/db.js';
import { ParamList, escapeLikePattern } from './catalogue.repository.js';

function executor(db) {
  return db?.query ?? poolQuery;
}

function rows(result) {
  return result?.rows ?? [];
}

/** Upper-cases and strips whitespace, matching the 023 storage rule. */
export function normaliseCode(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/ /g, '');
}

const COUPON_COLUMNS = `
  id, code, description, discount_type, discount_value, min_subtotal, max_discount,
  valid_from, valid_until, max_uses, used_count, per_user_limit, is_active,
  created_at, updated_at`;

/**
 * Finds a coupon by its normalised code.
 *
 * @param {object} db
 * @param {string} code the raw code typed by a shopper or admin
 * @param {{ forUpdate?: boolean }} [options] lock the row for redemption
 * @returns {Promise<object|null>}
 */
export async function findByCode(db, code, { forUpdate = false } = {}) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const result = await executor(db)(
    `SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = $1${suffix}`,
    [normaliseCode(code)]
  );
  return rows(result)[0] ?? null;
}

/** By primary key — the admin surface. */
export async function findById(db, id) {
  const result = await executor(db)(`SELECT ${COUPON_COLUMNS} FROM coupons WHERE id = $1`, [id]);
  return rows(result)[0] ?? null;
}

/**
 * How many non-cancelled orders this customer has already placed with a coupon.
 *
 * Used for `per_user_limit`. Cancelled orders are excluded so a cancelled
 * checkout does not consume a customer's allowance.
 */
export async function countUserRedemptions(db, couponId, userId) {
  const result = await executor(db)(
    `SELECT COUNT(*)::int AS n
       FROM orders
      WHERE coupon_id = $1 AND user_id = $2 AND status <> 'CANCELLED'`,
    [couponId, userId]
  );
  return Number(rows(result)[0]?.n ?? 0);
}

/**
 * Spends one use of a coupon. Called inside the checkout transaction, after the
 * row has been locked, so the increment is seen by every later checkout.
 */
export async function redeem(db, couponId) {
  const result = await executor(db)(
    `UPDATE coupons
        SET used_count = used_count + 1,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, used_count`,
    [couponId]
  );
  return rows(result)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Admin surface                                                               */
/* -------------------------------------------------------------------------- */

export const ADMIN_COUPON_SORTS = Object.freeze({
  newest: 'c.created_at DESC, c.id DESC',
  oldest: 'c.created_at ASC, c.id ASC',
  code: 'c.code ASC, c.id ASC',
  'used-desc': 'c.used_count DESC, c.code ASC',
});

function pickSort(key, fallback) {
  return ADMIN_COUPON_SORTS[key] ?? ADMIN_COUPON_SORTS[fallback];
}

/** A page of coupons, newest first, with a search over code and description. */
export async function listCoupons(db, filters, page) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.isActive === true) clauses.push('c.is_active = TRUE');
  if (filters.isActive === false) clauses.push('c.is_active = FALSE');
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(c.code ILIKE ${pattern} ESCAPE '\\' OR c.description ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy = pickSort(page.sort, 'newest');

  const sql = `
    SELECT c.id, c.code, c.description, c.discount_type, c.discount_value,
           c.min_subtotal, c.max_discount, c.valid_from, c.valid_until,
           c.max_uses, c.used_count, c.per_user_limit, c.is_active,
           c.created_at, c.updated_at,
           count(*) OVER ()::int AS total_count
      FROM coupons c
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countCoupons(db, filters);
  return { rows: data, total };
}

export async function countCoupons(db, filters) {
  const execute = executor(db);
  const params = new ParamList();
  const clauses = [];

  if (filters.isActive === true) clauses.push('c.is_active = TRUE');
  if (filters.isActive === false) clauses.push('c.is_active = FALSE');
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(c.code ILIKE ${pattern} ESCAPE '\\' OR c.description ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execute(`SELECT count(*)::int AS total FROM coupons c ${where}`, params.values);
  return Number(rows(result)[0]?.total ?? 0);
}

/**
 * @param {object} db
 * @param {{ code: string, description?: string|null, discountType: string,
 *           discountValue: number, minSubtotal: number, maxDiscount?: number|null,
 *           validFrom?: Date|string|null, validUntil?: Date|string|null,
 *           maxUses?: number|null, perUserLimit?: number|null, isActive?: boolean }} input
 */
export async function insertCoupon(db, input) {
  const result = await executor(db)(
    `INSERT INTO coupons
       (code, description, discount_type, discount_value, min_subtotal, max_discount,
        valid_from, valid_until, max_uses, per_user_limit, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), $8, $9, $10, COALESCE($11, TRUE))
     RETURNING ${COUPON_COLUMNS}`,
    [
      input.code,
      input.description ?? null,
      input.discountType,
      input.discountValue,
      input.minSubtotal ?? 0,
      input.maxDiscount ?? null,
      input.validFrom ?? null,
      input.validUntil ?? null,
      input.maxUses ?? null,
      input.perUserLimit ?? null,
      input.isActive,
    ]
  );
  return rows(result)[0] ?? null;
}

/**
 * Applies a validated patch. Only the columns a caller actually supplies are
 * written, so an update can change one field without clobbering the rest.
 *
 * @param {object} db
 * @param {string} id
 * @param {{ set: string[], values: unknown[] }} patch from the service
 */
export async function updateCoupon(db, id, patch) {
  if (patch.set.length === 0) return findById(db, id);

  const params = new ParamList();
  for (const value of patch.values) params.add(value);
  const idParam = params.add(id);

  const result = await executor(db)(
    `UPDATE coupons
        SET ${patch.set.map((column, index) => `${column} = $${index + 1}`).join(', ')},
            updated_at = NOW()
      WHERE id = ${idParam}
      RETURNING ${COUPON_COLUMNS}`,
    params.values
  );
  return rows(result)[0] ?? null;
}

/** Turns a coupon's active flag on or off (deactivate / reactivate). */
export async function setActive(db, id, isActive) {
  const result = await executor(db)(
    `UPDATE coupons
        SET is_active = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${COUPON_COLUMNS}`,
    [id, isActive]
  );
  return rows(result)[0] ?? null;
}

export default {
  normaliseCode,
  findByCode,
  findById,
  countUserRedemptions,
  redeem,
  listCoupons,
  countCoupons,
  insertCoupon,
  updateCoupon,
  setActive,
  ADMIN_COUPON_SORTS,
};