/**
 * Customer administration.
 *
 * An operator may look up a customer, see how much they have ordered and spent,
 * read their order history, and suspend or reactivate the account. Nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 *   Passwords. The user repository's admin reader never selects `password_hash`,
 *   so no amount of serialisation can expose it, and there is no reset here —
 *   an operator cannot set or reveal a customer's credential.
 *
 *   Staff accounts. Status may only be changed for users whose role is
 *   CUSTOMER. Suspend/activate exists to control shoppers; applying it to an
 *   administrator would let one admin lock out another (or themselves), which is
 *   an account-management problem, not a store-management one.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AUDIT_ACTION, AUDIT_ENTITY, ROLES } from '../../config/constants.js';
import * as repo from '../../repositories/admin.repository.js';
import { toAdminCustomerDetail, toAdminCustomerListItem } from '../admin.view.js';
import { recordAudit } from './audit.js';
import { notFound, paginationMeta, resolvePaging, unprocessable } from './common.js';

const RECENT_ORDER_LIMIT = 10;

export async function listCustomers(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = { search: query.search, status: query.status, role: query.role };

  const { rows, total } = await repo.listAdminCustomers(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    customers: rows.map(toAdminCustomerListItem),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getCustomer(db, id) {
  const customer = await repo.findAdminCustomerById(db, id);
  if (!customer) throw notFound('Customer not found.');

  const orders = await repo.listOrdersForCustomer(db, id, { limit: RECENT_ORDER_LIMIT, offset: 0 });

  return toAdminCustomerDetail({
    customer,
    orders,
    ordersTotal: Number(customer.order_count ?? 0),
  });
}

export async function updateStatus(db, actor, id, input) {
  return runInTransaction(db, async (tx) => {
    const customer = await repo.findAdminCustomerById(tx, id);
    if (!customer) throw notFound('Customer not found.');

    if (customer.role !== ROLES.CUSTOMER) {
      throw unprocessable('Only customer accounts can be suspended or activated.');
    }

    if (customer.status !== input.status) {
      await repo.updateUserStatus(tx, id, input.status);
      await recordAudit(tx, actor, {
        action: AUDIT_ACTION.CUSTOMER_STATUS_CHANGED,
        entityType: AUDIT_ENTITY.CUSTOMER,
        entityId: id,
        summary: `Customer "${customer.name}" set to ${input.status}.`,
        changes: { before: { status: customer.status }, after: { status: input.status } },
      });
    }

    const updated = await repo.findAdminCustomerById(tx, id);
    const orders = await repo.listOrdersForCustomer(tx, id, {
      limit: RECENT_ORDER_LIMIT,
      offset: 0,
    });
    return toAdminCustomerDetail({
      customer: updated,
      orders,
      ordersTotal: Number(updated.order_count ?? 0),
    });
  });
}

export default { listCustomers, getCustomer, updateStatus };
