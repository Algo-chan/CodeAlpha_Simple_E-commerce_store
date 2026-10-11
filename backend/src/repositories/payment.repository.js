/**
 * Payment repository — the read/write side of the `payments` audit trail.
 *
 * The insert path lives in `order.repository.js` (checkout and the read model
 * share it); this file owns everything Phase 9 adds: finding a row by the
 * provider's transaction reference, attaching a reference to a pending intent,
 * settling a row idempotently, and expiring stale attempts.
 *
 * Idempotency is enforced in SQL, not in application code:
 *   - `idx_payments_transaction_reference` is a partial unique index, so the
 *     same gateway transaction can never produce two rows;
 *   - `markSettled` guards on `status = 'PENDING'`, so a webhook arriving a
 *     second time touches zero rows and the caller reports a benign duplicate
 *     instead of re-applying side effects.
 */
import { query as poolQuery } from '../config/db.js';

function executor(db) {
  return db.query ?? poolQuery;
}

function rows(result) {
  return result?.rows ?? [];
}

const PAYMENT_COLUMNS = `
  id, order_id, provider, method, status, amount, currency,
  transaction_reference, failure_reason, paid_at, created_at, updated_at`;

/**
 * A payment row by its provider transaction reference. Returns null when the
 * gateway is reporting a transaction this store never created.
 */
export async function findByReference(db, reference) {
  const result = await executor(db)(
    `SELECT ${PAYMENT_COLUMNS}
       FROM payments
      WHERE transaction_reference = $1`,
    [reference]
  );
  return rows(result)[0] ?? null;
}

/**
 * Locks a payment row for the rest of the transaction. Serialises concurrent
 * webhooks for the same transaction so two notifications cannot both pass the
 * satisfaction check before either settles.
 */
export async function lockByReference(db, reference) {
  const result = await executor(db)(
    `SELECT ${PAYMENT_COLUMNS}
       FROM payments
      WHERE transaction_reference = $1
      FOR UPDATE`,
    [reference]
  );
  return rows(result)[0] ?? null;
}

/**
 * The most recent ONLINE attempt for an order that is still awaiting payment.
 * A retry reuses this row's provider reference only if there is a live one;
 * otherwise the service creates a fresh attempt.
 */
export async function findPendingByOrder(db, orderId) {
  const result = await executor(db)(
    `SELECT ${PAYMENT_COLUMNS}
       FROM payments
      WHERE order_id = $1 AND method = 'ONLINE' AND status = 'PENDING'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [orderId]
  );
  return rows(result)[0] ?? null;
}

/**
 * Records the provider's transaction reference on a payment intent.
 * Keeps an existing reference so a provider's idempotency key survives.
 */
export async function attachReference(db, id, transactionReference) {
  const result = await executor(db)(
    `UPDATE payments
        SET transaction_reference = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${PAYMENT_COLUMNS}`,
    [id, transactionReference]
  );
  return rows(result)[0] ?? null;
}

/**
 * Moves a PENDING payment to its terminal state.
 *
 * `WHERE status = 'PENDING'` is the idempotency guard: the second identical
 * webhook matches nothing and returns null, meaning "already handled".
 *
 * @returns {Promise<object|null>} the settled row, or null when already settled
 */
export async function markSettled(db, id, { status, failureReason, paidAt }) {
  const result = await executor(db)(
    `UPDATE payments
        SET status = $2,
            failure_reason = $3,
            paid_at = COALESCE($4, paid_at),
            updated_at = NOW()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING ${PAYMENT_COLUMNS}`,
    [id, status, failureReason ?? null, paidAt ?? null]
  );
  return rows(result)[0] ?? null;
}

/**
 * Expires ONLINE payment attempts that have stood PENDING past a cutoff.
 * Returns the settled rows so the caller can reconcile the owning orders.
 *
 * @param {object} db
 * @param {Date} cutoff
 * @param {{ orderId?: string|null }} [options]
 * @returns {Promise<object[]>} the FAILED rows
 */
export async function expirePendingBefore(db, cutoff, { orderId = null } = {}) {
  const result = await executor(db)(
    `UPDATE payments
        SET status = 'FAILED',
            failure_reason = 'Payment timed out.',
            updated_at = NOW()
      WHERE status = 'PENDING'
        AND method = 'ONLINE'
        AND created_at < $1
        AND ($2::uuid IS NULL OR order_id = $2)
      RETURNING id, order_id`,
    [cutoff, orderId]
  );
  return rows(result);
}

export default {
  findByReference,
  lockByReference,
  findPendingByOrder,
  attachReference,
  markSettled,
  expirePendingBefore,
};
