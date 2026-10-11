/**
 * Inventory repository — the only place allowed to run stock SQL.
 *
 * The ledger is append-only (migration 009), so every movement writes both the
 * current balance (`inventory.quantity`) and a compensating
 * `inventory_transactions` row. Deduction is a single conditional UPDATE:
 *
 *   UPDATE inventory
 *      SET quantity = quantity - n
 *    WHERE variant_id = $1
 *      AND quantity - reserved_quantity >= n
 *
 * The `AND` is the oversell guard. It makes the check and the decrement one
 * atomic statement, so two concurrent checkouts for the last unit cannot both
 * see "1 available" and both succeed — one UPDATE matches, the other affects
 * zero rows and the caller rolls the whole transaction back. Reserved units are
 * excluded from what a sale may consume.
 *
 * A missing inventory row is not an error: the schema models an untracked
 * (digital) product as having no row, so callers skip deduction and the ledger
 * for it.
 */
import { query as poolQuery } from '../config/db.js';

function executor(db) {
  return db.query ?? poolQuery;
}

function changed(result) {
  const n = result?.rowCount ?? result?.affectedRows ?? 0;
  return Number(n) > 0;
}

/**
 * Locks the inventory row for a variant for the rest of the transaction.
 * Returns null when there is no row (untracked product).
 */
export async function lockInventory(db, variantId) {
  const result = await executor(db)(
    `SELECT variant_id, quantity, reserved_quantity
       FROM inventory
      WHERE variant_id = $1
      FOR UPDATE`,
    [variantId]
  );
  return result.rows[0] ?? null;
}

/**
 * Atomically removes `quantity` units from stock.
 *
 * @returns {Promise<boolean>} true when the units were removed; false when the
 *   conditional WHERE did not match (insufficient stock) — the caller must
 *   treat false as a failure and roll back.
 */
export async function deduct(db, variantId, quantity) {
  const result = await executor(db)(
    `UPDATE inventory
        SET quantity = quantity - $2, updated_at = NOW()
      WHERE variant_id = $1
        AND quantity - reserved_quantity >= $2`,
    [variantId, quantity]
  );
  return changed(result);
}

/**
 * Appends one stock movement to the ledger.
 *
 * @param {object} db
 * @param {{ variantId: string, quantity: number, type: string,
 *           referenceType?: string|null, referenceId?: string|null,
 *           note?: string|null, createdBy?: string|null }} input
 */
export async function recordTransaction(db, input) {
  const result = await executor(db)(
    `INSERT INTO inventory_transactions
       (variant_id, transaction_type, quantity, reference_type, reference_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.variantId,
      input.type,
      input.quantity,
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.note ?? null,
      input.createdBy ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

export default { lockInventory, deduct, recordTransaction };
