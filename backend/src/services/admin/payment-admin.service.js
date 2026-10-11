/**
 * Payment inspection.
 *
 * Read-only, on purpose. A payment row records what a gateway (or the store, for
 * cash on delivery) reported; an operator may look but never edit, because
 * rewriting a payment would make the order's payment_status a story rather than
 * a fact. The one identifier exposed, `transaction_reference`, is the provider's
 * own public id — never a key, a secret or card data, none of which this store
 * stores in the first place.
 */
import * as repo from '../../repositories/admin.repository.js';
import { toAdminPayment } from '../admin.view.js';
import { notFound, paginationMeta, resolvePaging } from './common.js';

export async function listPayments(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = {
    search: query.search,
    status: query.status,
    provider: query.provider,
    method: query.method,
  };

  const { rows, total } = await repo.listAdminPayments(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    payments: rows.map(toAdminPayment),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getPayment(db, id) {
  const payment = await repo.findAdminPaymentById(db, id);
  if (!payment) throw notFound('Payment not found.');
  return toAdminPayment(payment);
}

export default { listPayments, getPayment };
