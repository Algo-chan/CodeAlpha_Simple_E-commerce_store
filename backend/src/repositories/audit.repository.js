/**
 * Audit repository — the append-only administrative action trail.
 *
 * There is no update and no delete. A row is inserted once, by the service that
 * performed the action, through the same transaction executor, so the record
 * and the change it describes either both exist or neither does. That is the
 * whole value of the table: it cannot be made to disagree with reality by a
 * later rollback, and it cannot be quietly edited afterwards.
 *
 * `actor_email` is a snapshot taken at write time. `actor_id` is a foreign key
 * with ON DELETE SET NULL, but when the account is removed the email on the row
 * still says who did it, so history stays readable.
 */
import { query as poolQuery } from '../config/db.js';
import { ParamList, escapeLikePattern } from './catalogue.repository.js';

function executor(db) {
  return db?.query ?? poolQuery;
}

function rows(result) {
  return result?.rows ?? [];
}

/**
 * Writes one audit row.
 *
 * @param {object} db transaction executor
 * @param {{ actorId?: string|null, actorEmail?: string|null, action: string,
 *           entityType: string, entityId?: string|null, summary?: string|null,
 *           changes?: object|null }} entry
 * @returns {Promise<{ id: string }|null>}
 */
export async function insertAuditLog(db, entry) {
  const result = await executor(db)(
    `INSERT INTO audit_logs
       (actor_id, actor_email, action, entity_type, entity_id, summary, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      entry.actorId ?? null,
      entry.actorEmail ?? null,
      entry.action,
      entry.entityType,
      entry.entityId != null ? String(entry.entityId) : null,
      entry.summary ?? null,
      entry.changes != null ? JSON.stringify(entry.changes) : null,
    ]
  );
  return rows(result)[0] ?? null;
}

/** Compiles the shared WHERE clause for audit filters. */
function compileFilters(filters) {
  const params = new ParamList();
  const clauses = [];

  if (filters.entityType) clauses.push(`a.entity_type = ${params.add(filters.entityType)}`);
  if (filters.action) clauses.push(`a.action = ${params.add(filters.action)}`);
  if (filters.actorId) clauses.push(`a.actor_id = ${params.add(filters.actorId)}`);
  if (filters.search) {
    const pattern = params.add(`%${escapeLikePattern(filters.search)}%`);
    clauses.push(
      `(a.summary ILIKE ${pattern} ESCAPE '\\' OR a.actor_email ILIKE ${pattern} ESCAPE '\\' OR a.entity_id ILIKE ${pattern} ESCAPE '\\')`
    );
  }

  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * A page of the audit feed, newest first.
 *
 * @param {{ entityType?: string, action?: string, actorId?: string, search?: string }} filters
 * @param {{ limit: number, offset: number, sort?: string }} page
 * @param {{ query?: Function }} [db]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listAuditLogs(db, filters, page) {
  const execute = executor(db);
  const { clause, params } = compileFilters(filters);
  const limitParam = params.add(page.limit);
  const offsetParam = params.add(page.offset);
  const orderBy =
    page.sort === 'oldest' ? 'a.created_at ASC, a.id ASC' : 'a.created_at DESC, a.id DESC';

  const result = await execute(
    `SELECT
       a.id, a.actor_id, a.actor_email, a.action, a.entity_type, a.entity_id,
       a.summary, a.changes, a.created_at,
       count(*) OVER ()::int AS total_count
     FROM audit_logs a
     ${clause}
     ORDER BY ${orderBy}
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params.values
  );

  const data = rows(result);
  const total =
    data.length > 0 ? Number(data[0].total_count ?? 0) : await countAuditLogs(db, filters);
  return { rows: data, total };
}

export async function countAuditLogs(db, filters) {
  const execute = executor(db);
  const { clause, params } = compileFilters(filters);
  const result = await execute(
    `SELECT count(*)::int AS total FROM audit_logs a ${clause}`,
    params.values
  );
  return Number(rows(result)[0]?.total ?? 0);
}

export default { insertAuditLog, listAuditLogs, countAuditLogs };
