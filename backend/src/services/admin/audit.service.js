/**
 * Audit-log reader.
 *
 * Read-only and unfilterable in any way that could hide a row: the feed can be
 * narrowed by entity, action or actor, but there is no delete and no update, and
 * the repository offers none. What an operator sees here is what happened.
 */
import * as auditRepo from '../../repositories/audit.repository.js';
import { toAuditLog } from '../admin.view.js';
import { paginationMeta, resolvePaging } from './common.js';

export async function listAuditLogs(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = {
    search: query.search,
    entityType: query.entityType,
    action: query.action,
    actorId: query.actorId,
  };

  const { rows, total } = await auditRepo.listAuditLogs(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    logs: rows.map(toAuditLog),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export default { listAuditLogs };
