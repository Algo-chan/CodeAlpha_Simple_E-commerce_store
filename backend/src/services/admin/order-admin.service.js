/**
 * Order administration — search, inspect and advance an order.
 *
 * STATUS CHANGES ARE A GRAPH, NOT A CHECKLIST
 *
 * `ORDER_TRANSITIONS` (constants) encodes which moves a fulfilment lifecycle
 * allows: PENDING -> CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED, with a
 * CANCELLED escape hatch before shipping and no way back out of a terminal
 * state. This service is the only place that graph is interpreted, so "no
 * arbitrary status jumps" is one rule rather than a set of scattered checks.
 *
 * CANCELLING RESTOCKS. Checkout removes stock the moment an order is placed
 * (see `checkout.service`), so cancelling without returning it would leak
 * inventory. Every tracked line is added back and a RETURN ledger row records
 * why, referencing the order. Because CANCELLED is terminal and re-cancelling is
 * refused, the stock can never be returned twice.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AppError } from '../../utils/app-error.js';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  ERROR_CODES,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
} from '../../config/constants.js';
import * as repo from '../../repositories/admin.repository.js';
import * as orderRepo from '../../repositories/order.repository.js';
import * as inventory from '../../repositories/inventory.repository.js';
import { toAdminOrderDetail, toAdminOrderListItem } from '../admin.view.js';
import { recordAudit } from './audit.js';
import { notFound, paginationMeta, resolvePaging, unprocessable } from './common.js';

export async function listOrders(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = {
    search: query.search,
    status: query.status,
    paymentStatus: query.paymentStatus,
  };

  const { rows, total } = await repo.listAdminOrders(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    orders: rows.map(toAdminOrderListItem),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getOrder(db, orderNumber) {
  const order = await orderRepo.findByNumber(db, orderNumber);
  if (!order) throw notFound('Order not found.');

  const [items, payment] = await Promise.all([
    orderRepo.listItemsByOrder(db, order.id),
    orderRepo.findLatestPayment(db, order.id),
  ]);

  return toAdminOrderDetail({ order, items, payment });
}

/** Rejects a status change the lifecycle does not allow, with a clear reason. */
function assertTransition(from, to) {
  if (to === from) {
    throw unprocessable(`Order is already ${from}.`);
  }
  const allowed = ORDER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      `An order in ${from} cannot move to ${to}.`,
      422,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from, to, allowed }
    );
  }
}

/**
 * Returns every tracked line of an order to stock and records the movement.
 * Runs inside the caller's transaction, so a failure restores nothing.
 */
async function restockOrder(tx, order) {
  const items = await orderRepo.listItemsByOrder(tx, order.id);
  for (const item of items) {
    if (!item.variant_id) continue; // digital line, no stock to return
    const stock = await inventory.lockInventory(tx, item.variant_id);
    if (!stock) continue; // untracked: checkout never deducted it

    const quantity = Number(item.quantity);
    const updated = await repo.applyStockDelta(tx, item.variant_id, quantity);
    if (!updated) continue; // unreachable: adding stock cannot go negative

    await inventory.recordTransaction(tx, {
      variantId: item.variant_id,
      type: 'RETURN',
      quantity,
      referenceType: 'ORDER',
      referenceId: order.id,
      note: `Order ${order.order_number} cancelled`,
      createdBy: null,
    });
  }
}

export async function updateStatus(db, actor, orderNumber, input) {
  return runInTransaction(db, async (tx) => {
    const order = await repo.lockOrderByNumber(tx, orderNumber);
    if (!order) throw notFound('Order not found.');

    assertTransition(order.status, input.status);

    if (input.status === ORDER_STATUS.CANCELLED) {
      await restockOrder(tx, order);
    }

    await repo.updateOrderStatus(tx, orderNumber, input.status);

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.ORDER_STATUS_CHANGED,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: order.id,
      summary: `Order ${orderNumber}: ${order.status} -> ${input.status}.`,
      changes: {
        before: { status: order.status },
        after: { status: input.status },
        ...(input.note ? { note: input.note } : {}),
      },
    });

    const [full, items, payment] = await Promise.all([
      orderRepo.findByNumber(tx, orderNumber),
      orderRepo.listItemsByOrder(tx, order.id),
      orderRepo.findLatestPayment(tx, order.id),
    ]);

    return toAdminOrderDetail({ order: full, items, payment });
  });
}

export default { listOrders, getOrder, updateStatus };
