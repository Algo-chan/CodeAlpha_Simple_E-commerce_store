/**
 * Coupon administration.
 *
 * A coupon is money, so the same integer discipline as the rest of the store
 * applies: `discountValue` and `maxDiscount` are minor units (or, for a PERCENT
 * code, a whole percent) and `minSubtotal` is minor units. The validator bounds
 * each field; this service enforces the cross-field rules a schema cannot see
 * (a percent cap on a fixed code, an inverted validity window) and the
 * uniqueness of a code before the database has to.
 *
 * EVERY MUTATION IS AUDITED IN ITS OWN TRANSACTION. The audit row is written
 * with the change, so the trail can never claim a coupon was created or
 * deactivated when the write rolled back. Activating or deactivating through
 * `PATCH` records the specific action rather than a generic update, because
 * "who turned this off" is the question an audit trail exists to answer.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AUDIT_ACTION, AUDIT_ENTITY, COUPON_TYPE } from '../../config/constants.js';
import * as repo from '../../repositories/coupon.repository.js';
import { toAdminCoupon } from '../admin.view.js';
import { recordAudit } from './audit.js';
import { conflict, notFound, paginationMeta, resolvePaging, unprocessable } from './common.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function numOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

/** The mutable columns, in the order `insertCoupon`/`updateCoupon` expect. */
function toColumns(coupon) {
  return [
    ['code', coupon.code],
    ['description', coupon.description],
    ['discount_type', coupon.discountType],
    ['discount_value', coupon.discountValue],
    ['min_subtotal', coupon.minSubtotal],
    ['max_discount', coupon.maxDiscount],
    ['valid_from', coupon.validFrom],
    ['valid_until', coupon.validUntil],
    ['max_uses', coupon.maxUses],
    ['per_user_limit', coupon.perUserLimit],
    ['is_active', coupon.isActive],
  ];
}

/** Maps a validated create body to the repository's camelCase input. */
function fromCreateInput(input) {
  return {
    code: repo.normaliseCode(input.code),
    description: input.description ?? null,
    discountType: input.discountType,
    discountValue: input.discountValue,
    minSubtotal: input.minSubtotal ?? 0,
    maxDiscount: numOrNull(input.maxDiscount),
    validFrom: input.validFrom ?? null,
    validUntil: numOrNull(input.validUntil),
    maxUses: numOrNull(input.maxUses),
    perUserLimit: numOrNull(input.perUserLimit),
    isActive: input.isActive ?? true,
  };
}

/** Folds a partial update onto the current row, field by field. */
function mergeUpdate(current, input) {
  return {
    code: input.code !== undefined ? repo.normaliseCode(input.code) : current.code,
    description: 'description' in input ? input.description : (current.description ?? null),
    discountType: input.discountType ?? current.discount_type,
    discountValue: input.discountValue ?? Number(current.discount_value),
    minSubtotal: input.minSubtotal ?? Number(current.min_subtotal),
    maxDiscount:
      'maxDiscount' in input ? numOrNull(input.maxDiscount) : numOrNull(current.max_discount),
    validFrom: input.validFrom ?? current.valid_from,
    validUntil:
      'validUntil' in input ? numOrNull(input.validUntil) : numOrNull(current.valid_until),
    maxUses: 'maxUses' in input ? numOrNull(input.maxUses) : numOrNull(current.max_uses),
    perUserLimit:
      'perUserLimit' in input ? numOrNull(input.perUserLimit) : numOrNull(current.per_user_limit),
    isActive: input.isActive ?? current.is_active === true,
  };
}

/** Cross-field rules that depend on the fully merged coupon. */
function assertRules(coupon) {
  if (coupon.discountType === COUPON_TYPE.FIXED && coupon.maxDiscount !== null) {
    throw unprocessable('A fixed-amount coupon cannot set a maximum discount.');
  }
  if (coupon.discountType === COUPON_TYPE.PERCENT && coupon.discountValue > 100) {
    throw unprocessable('A percentage discount cannot be more than 100.');
  }
  if (coupon.validFrom && coupon.validUntil) {
    if (new Date(coupon.validUntil) < new Date(coupon.validFrom)) {
      throw unprocessable('validUntil must be on or after validFrom.');
    }
  }
  if (coupon.maxUses !== null && coupon.maxUses < 1) {
    throw unprocessable('maxUses must be at least 1, or omitted for unlimited.');
  }
}

/** A compact before/after of only the fields that actually changed. */
function diff(before, after) {
  const beforeChanged = {};
  const afterChanged = {};
  for (const key of Object.keys(after)) {
    const a = after[key];
    const b = before[key];
    const same =
      a === b ||
      (a instanceof Date && b instanceof Date && a.getTime() === b.getTime()) ||
      (a !== null && b !== null && String(a) === String(b));
    if (!same) {
      beforeChanged[key] = b;
      afterChanged[key] = a;
    }
  }
  return { before: beforeChanged, after: afterChanged };
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export async function listCoupons(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = { search: query.search, isActive: query.isActive };

  const { rows, total } = await repo.listCoupons(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    coupons: rows.map(toAdminCoupon),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getCoupon(db, id) {
  const coupon = await repo.findById(db, id);
  if (!coupon) throw notFound('Coupon not found.');
  return toAdminCoupon(coupon);
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

export async function createCoupon(db, actor, input) {
  return runInTransaction(db, async (tx) => {
    const coupon = fromCreateInput(input);
    assertRules(coupon);

    if (await repo.findByCode(tx, coupon.code)) {
      throw conflict('A coupon with that code already exists.');
    }

    const created = await repo.insertCoupon(tx, coupon);

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.COUPON_CREATED,
      entityType: AUDIT_ENTITY.COUPON,
      entityId: created.id,
      summary: `Created coupon ${created.code}.`,
      changes: { after: toAdminCoupon(created) },
    });

    return toAdminCoupon(created);
  });
}

export async function updateCoupon(db, actor, id, input) {
  return runInTransaction(db, async (tx) => {
    const current = await repo.findById(tx, id);
    if (!current) throw notFound('Coupon not found.');

    const merged = mergeUpdate(current, input);
    assertRules(merged);

    if (merged.code !== current.code && (await repo.findByCode(tx, merged.code))) {
      throw conflict('A coupon with that code already exists.');
    }

    const [set, values] = toColumns(merged).reduce(
      ([columns, params], [column, value]) => {
        columns.push(column);
        params.push(value);
        return [columns, params];
      },
      [[], []]
    );

    const updated = await repo.updateCoupon(tx, id, { set, values });

    let action = AUDIT_ACTION.COUPON_UPDATED;
    if (input.isActive !== undefined && input.isActive !== (current.is_active === true)) {
      action = input.isActive ? AUDIT_ACTION.COUPON_ACTIVATED : AUDIT_ACTION.COUPON_DEACTIVATED;
    }

    await recordAudit(tx, actor, {
      action,
      entityType: AUDIT_ENTITY.COUPON,
      entityId: id,
      summary: `Updated coupon ${updated.code}.`,
      changes: diff(toAdminCoupon(current), toAdminCoupon(updated)),
    });

    return toAdminCoupon(updated);
  });
}

/** Convenience wrapper for the activate/deactivate endpoints. */
export function setCouponActive(db, actor, id, isActive) {
  return updateCoupon(db, actor, id, { isActive });
}

export default { listCoupons, getCoupon, createCoupon, updateCoupon, setCouponActive };
