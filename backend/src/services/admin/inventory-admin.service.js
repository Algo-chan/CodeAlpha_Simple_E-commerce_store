/**
 * Inventory administration.
 *
 * EVERY MANUAL CHANGE WRITES A LEDGER ROW. That is not optional and not a
 * convenience: the stock ledger is the only record of why a balance moved, and
 * an operator correcting a count without a trace would make the ledger lie.
 * The balance update and its ledger row are written in one transaction, so a
 * failed audit insert rolls the balance back with it.
 *
 * The sign convention lives here, not in the client. RESTOCK and RETURN add,
 * DAMAGE removes, and only ADJUSTMENT is allowed to be negative because it is a
 * counted correction rather than a direction. A client that sends
 * `{ type: 'RESTOCK', quantity: -5 }` is rejected by the schema; one that sends
 * a valid positive figure does not get to choose which way it moves.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AUDIT_ACTION, AUDIT_ENTITY, INVENTORY_TRANSACTION_TYPE } from '../../config/constants.js';
import * as repo from '../../repositories/admin.repository.js';
import { recordTransaction } from '../../repositories/inventory.repository.js';
import { toAdminInventoryItem, toAdminLedgerEntry } from '../admin.view.js';
import { recordAudit } from './audit.js';
import { notFound, paginationMeta, resolvePaging, unprocessable } from './common.js';

export async function listInventory(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = { search: query.search, lowStock: query.lowStock };

  const { rows, total } = await repo.listAdminInventory(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    items: rows.map(toAdminInventoryItem),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getLedger(db, variantId, query) {
  const variant = await repo.findVariantById(db, variantId);
  if (!variant) throw notFound('Variant not found.');

  const { page, limit, offset } = resolvePaging(query);
  const { rows, total } = await repo.listInventoryLedger(db, variantId, { limit, offset });

  return {
    variant: { id: variant.id, sku: variant.sku, productName: variant.product_name },
    entries: rows.map(toAdminLedgerEntry),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

/** Translates a validated adjustment into the signed movement to record. */
function toSignedQuantity(type, quantity) {
  switch (type) {
    case INVENTORY_TRANSACTION_TYPE.RESTOCK:
    case INVENTORY_TRANSACTION_TYPE.RETURN:
      return Math.abs(quantity);
    case INVENTORY_TRANSACTION_TYPE.DAMAGE:
      return -Math.abs(quantity);
    case INVENTORY_TRANSACTION_TYPE.ADJUSTMENT:
      return quantity;
    default:
      return quantity;
  }
}

export async function adjustInventory(db, actor, variantId, input) {
  return runInTransaction(db, async (tx) => {
    const variant = await repo.findVariantById(tx, variantId);
    if (!variant) throw notFound('Variant not found.');

    // First movement against an untracked variant opts it into stock tracking.
    await repo.ensureInventoryRow(tx, variantId);

    const delta = toSignedQuantity(input.type, input.quantity);
    const updated = await repo.applyStockDelta(tx, variantId, delta);
    if (!updated) {
      throw unprocessable('That adjustment would take the available stock below zero.');
    }

    await recordTransaction(tx, {
      variantId,
      type: input.type,
      quantity: delta,
      referenceType: 'MANUAL',
      referenceId: null,
      note: input.note ?? null,
      createdBy: actor?.id ?? null,
    });

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.INVENTORY_ADJUSTED,
      entityType: AUDIT_ENTITY.INVENTORY,
      entityId: variantId,
      summary: `${input.type} of ${delta} units for ${variant.sku}.`,
      changes: {
        before: { quantity: Number(updated.quantity) - delta },
        after: { quantity: Number(updated.quantity) },
        delta,
      },
    });

    return toAdminInventoryItem(await repo.findAdminInventoryItem(tx, variantId));
  });
}

export async function updateReorderLevel(db, actor, variantId, input) {
  return runInTransaction(db, async (tx) => {
    const variant = await repo.findVariantById(tx, variantId);
    if (!variant) throw notFound('Variant not found.');

    await repo.ensureInventoryRow(tx, variantId);
    const before = await repo.findInventoryByVariant(tx, variantId);

    await repo.updateReorderLevel(tx, variantId, input.reorderLevel);

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.INVENTORY_REORDER_LEVEL_UPDATED,
      entityType: AUDIT_ENTITY.INVENTORY,
      entityId: variantId,
      summary: `Reorder level for ${variant.sku} set to ${input.reorderLevel}.`,
      changes: {
        before: { reorderLevel: Number(before?.reorder_level ?? 0) },
        after: { reorderLevel: input.reorderLevel },
      },
    });

    return toAdminInventoryItem(await repo.findAdminInventoryItem(tx, variantId));
  });
}

export default { listInventory, getLedger, adjustInventory, updateReorderLevel };
