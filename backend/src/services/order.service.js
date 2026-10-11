/**
 * Order service — the customer's read side of an order.
 *
 * Writes live in `checkout.service.js`; this module only reads. Both go through
 * the same `order.repository` and the same `order.view`, so the confirmation a
 * shopper sees at checkout and the order they see a week later are byte-for-byte
 * the same document.
 *
 * AUTHORIZATION IS A QUERY CLAUSE, NOT A CHECK. Every lookup is scoped by
 * `user_id` in SQL (`findByNumberForUser`, `listByUser`). An order that belongs
 * to someone else is indistinguishable from one that does not exist — both are
 * a 404 — so the endpoint cannot be used to probe which order numbers are real.
 */
import { AppError } from '../utils/app-error.js';
import { ERROR_CODES, PAGINATION } from '../config/constants.js';
import * as orders from '../repositories/order.repository.js';
import { toOrderView, toOrderSummary } from './order.view.js';

function notFound() {
  return new AppError('Order not found.', 404, ERROR_CODES.NOT_FOUND);
}

/** Clamps a requested page size to the shared pagination bounds. */
function resolvePaging({ page, limit } = {}) {
  const safePage = Math.max(1, Number(page) || PAGINATION.DEFAULT_PAGE);
  const safeLimit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, Number(limit) || PAGINATION.DEFAULT_LIMIT)
  );
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

/**
 * A page of a customer's orders, newest first, each with its lines.
 *
 * @param {object} db
 * @param {string} userId
 * @param {{ page?: number, limit?: number }} [options]
 */
export async function listOrders(db, userId, options = {}) {
  const { page, limit, offset } = resolvePaging(options);

  const { rows, total } = await orders.listByUser(db, userId, { limit, offset });
  const itemsByOrder = await orders.listItemsForOrders(
    db,
    rows.map((row) => row.id)
  );

  return {
    orders: rows.map((order) => toOrderSummary(order, itemsByOrder.get(order.id) ?? [])),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: offset + rows.length < total,
      hasPreviousPage: page > 1,
    },
  };
}

/**
 * One order in full, scoped to its owner.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} orderNumber
 */
export async function getOrder(db, userId, orderNumber) {
  const order = await orders.findByNumberForUser(db, orderNumber, userId);
  if (!order) throw notFound();

  const [items, payment] = await Promise.all([
    orders.listItemsByOrder(db, order.id),
    orders.findLatestPayment(db, order.id),
  ]);

  return toOrderView({ order, items, payment });
}

export default { listOrders, getOrder };
