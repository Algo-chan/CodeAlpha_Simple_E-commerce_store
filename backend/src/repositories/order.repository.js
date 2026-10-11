/**
 * Order repository — the only place allowed to run order/payment SQL.
 *
 * Order numbers
 *   The format is `ORD-<YYYYMMDD>-<NNNN>` (migration 014). Numbering has to be
 *   unique under concurrency, so allocation takes a transaction-scoped advisory
 *   lock keyed on the day before counting that day's existing orders. Two
 *   concurrent checkouts on the same day therefore serialise on the lock instead
 *   of racing to the same number; the `orders_order_number_unique` index is the
 *   belt-and-braces guarantee if that lock is ever bypassed.
 *
 *   The advisory lock is released automatically at COMMIT/ROLLBACK, so it can
 *   never leak. The lock key is the date as an integer (20260115), which fits a
 *   `bigint` and needs no hashing.
 *
 * All writes are called inside the checkout transaction and accept the
 * transaction executor, so they commit or roll back together.
 */
import { query as poolQuery } from '../config/db.js';
import { ORDER_NUMBER } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

function executor(db) {
  return db.query ?? poolQuery;
}

function rows(result) {
  return result?.rows ?? [];
}

/** `YYYYMMDD` in UTC — the day label inside the order number. */
function formatDay(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/* -------------------------------------------------------------------------- */
/* Order number                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Allocates the next order number for `date`'s day.
 *
 * Must be called inside the checkout transaction; the advisory lock only means
 * anything for the life of that transaction.
 *
 * @param {object} tx transaction executor
 * @param {Date} [date]
 * @returns {Promise<string>}
 */
export async function nextOrderNumber(tx, date = new Date()) {
  const day = formatDay(date);
  const lockKey = Number(day);

  await executor(tx)('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  const prefix = `${ORDER_NUMBER.PREFIX}-${day}-`;
  const result = await executor(tx)(
    `SELECT COUNT(*)::int AS n FROM orders WHERE order_number LIKE $1`,
    [`${prefix}%`]
  );
  const next = Number(rows(result)[0]?.n ?? 0) + 1;

  if (next > ORDER_NUMBER.MAX_SEQUENCE) {
    throw new AppError(
      'Too many orders were placed today. Please try again tomorrow.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return `${prefix}${String(next).padStart(ORDER_NUMBER.SEQUENCE_PAD, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

const ORDER_COLUMNS = `
  id, order_number, user_id, status, subtotal, delivery_fee, discount_total,
  total, currency, payment_status, payment_method, customer_email,
  customer_phone, shipping_address_snapshot, customer_notes, created_at, updated_at`;

/**
 * @param {object} db
 * @param {{ orderNumber: string, userId: string|null, status: string,
 *           subtotal: number, deliveryFee: number, discountTotal: number,
 *           total: number, currency: string, paymentStatus: string,
 *           paymentMethod: string, customerEmail: string, customerPhone: string,
 *           shippingAddressSnapshot: object, customerNotes?: string|null }} input
 */
export async function insertOrder(db, input) {
  const result = await executor(db)(
    `INSERT INTO orders
       (order_number, user_id, status, subtotal, delivery_fee, discount_total,
        total, currency, payment_status, payment_method, customer_email,
        customer_phone, shipping_address_snapshot, customer_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::JSONB, $14)
     RETURNING ${ORDER_COLUMNS}`,
    [
      input.orderNumber,
      input.userId,
      input.status,
      input.subtotal,
      input.deliveryFee,
      input.discountTotal,
      input.total,
      input.currency,
      input.paymentStatus,
      input.paymentMethod,
      input.customerEmail,
      input.customerPhone,
      JSON.stringify(input.shippingAddressSnapshot),
      input.customerNotes ?? null,
    ]
  );
  return rows(result)[0] ?? null;
}

/** @param {object} db */
export async function findByNumber(db, orderNumber) {
  const result = await executor(db)(`SELECT ${ORDER_COLUMNS} FROM orders WHERE order_number = $1`, [
    orderNumber,
  ]);
  return rows(result)[0] ?? null;
}

/** By primary key — used by the payment service when a webhook resolves an order. */
export async function findById(db, id) {
  const result = await executor(db)(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
  return rows(result)[0] ?? null;
}

/**
 * Advances an order's state after a settled payment. Each column is only
 * overwritten when a value is supplied, so one statement serves both "payment
 * confirmed" and "payment failed" branches.
 */
export async function updateOrderState(db, orderId, { status, paymentStatus } = {}) {
  const result = await executor(db)(
    `UPDATE orders
        SET status = COALESCE($2, status),
            payment_status = COALESCE($3, payment_status),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${ORDER_COLUMNS}`,
    [orderId, status ?? null, paymentStatus ?? null]
  );
  return rows(result)[0] ?? null;
}

/** Scoped lookup for order history — an order belongs to exactly one customer. */
export async function findByNumberForUser(db, orderNumber, userId) {
  const result = await executor(db)(
    `SELECT ${ORDER_COLUMNS}
       FROM orders
      WHERE order_number = $1 AND user_id = $2`,
    [orderNumber, userId]
  );
  return rows(result)[0] ?? null;
}

/**
 * A page of a customer's orders, newest first, plus the total count.
 * @param {object} db
 */
export async function listByUser(db, userId, { limit, offset }) {
  const countResult = await executor(db)(
    `SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1`,
    [userId]
  );

  const result = await executor(db)(
    `SELECT ${ORDER_COLUMNS}
       FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return { rows: rows(result), total: Number(rows(countResult)[0]?.n ?? 0) };
}

/* -------------------------------------------------------------------------- */
/* Order items                                                                 */
/* -------------------------------------------------------------------------- */

const ITEM_COLUMNS = `
  id, order_id, product_id, variant_id, product_name, sku, variant_attributes,
  unit_price, quantity, subtotal, created_at`;

/**
 * @param {object} db
 * @param {{ orderId: string, productId: string, variantId: string|null,
 *           productName: string, sku: string|null, variantAttributes: object,
 *           unitPrice: number, quantity: number, subtotal: number }} input
 */
export async function insertOrderItem(db, input) {
  const result = await executor(db)(
    `INSERT INTO order_items
       (order_id, product_id, variant_id, product_name, sku, variant_attributes,
        unit_price, quantity, subtotal)
     VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7, $8, $9)
     RETURNING ${ITEM_COLUMNS}`,
    [
      input.orderId,
      input.productId,
      input.variantId,
      input.productName,
      input.sku ?? null,
      JSON.stringify(input.variantAttributes ?? {}),
      input.unitPrice,
      input.quantity,
      input.subtotal,
    ]
  );
  return rows(result)[0] ?? null;
}

export async function listItemsByOrder(db, orderId) {
  const result = await executor(db)(
    `SELECT ${ITEM_COLUMNS}
       FROM order_items
      WHERE order_id = $1
      ORDER BY created_at ASC, id ASC`,
    [orderId]
  );
  return rows(result);
}

/**
 * Items for many orders at once, grouped by `order_id`.
 *
 * Order history renders a page of orders, and fetching items per order is an
 * N+1 that grows with the page size. One `= ANY($1)` query returns the lot.
 *
 * @returns {Promise<Map<string, object[]>>}
 */
export async function listItemsForOrders(db, orderIds) {
  if (!orderIds || orderIds.length === 0) return new Map();

  const result = await executor(db)(
    `SELECT ${ITEM_COLUMNS}
       FROM order_items
      WHERE order_id = ANY($1::uuid[])
      ORDER BY created_at ASC, id ASC`,
    [orderIds]
  );

  const grouped = new Map();
  for (const row of rows(result)) {
    const bucket = grouped.get(row.order_id);
    if (bucket) bucket.push(row);
    else grouped.set(row.order_id, [row]);
  }
  return grouped;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

const PAYMENT_COLUMNS = `
  id, order_id, provider, method, status, amount, currency,
  transaction_reference, failure_reason, paid_at, created_at, updated_at`;

/**
 * Records a payment attempt. For COD this is created PENDING at checkout and
 * marked PAID when the courier collects; a future provider would add rows here
 * rather than change the orders table.
 */
export async function insertPayment(db, input) {
  const result = await executor(db)(
    `INSERT INTO payments
       (order_id, provider, method, status, amount, currency, transaction_reference,
        failure_reason, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PAYMENT_COLUMNS}`,
    [
      input.orderId,
      input.provider,
      input.method,
      input.status,
      input.amount,
      input.currency,
      input.transactionReference ?? null,
      input.failureReason ?? null,
      input.paidAt ?? null,
    ]
  );
  return rows(result)[0] ?? null;
}

/** The most recent payment row for an order — the order's payment story. */
export async function findLatestPayment(db, orderId) {
  const result = await executor(db)(
    `SELECT ${PAYMENT_COLUMNS}
       FROM payments
      WHERE order_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [orderId]
  );
  return rows(result)[0] ?? null;
}

export default {
  nextOrderNumber,
  insertOrder,
  findByNumber,
  findById,
  findByNumberForUser,
  listByUser,
  insertOrderItem,
  listItemsByOrder,
  listItemsForOrders,
  insertPayment,
  findLatestPayment,
  updateOrderState,
};
