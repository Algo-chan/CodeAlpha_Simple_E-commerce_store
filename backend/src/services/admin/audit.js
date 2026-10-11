/**
 * Audit writer.
 *
 * One function, called from inside the same transaction as the action it
 * describes. If the action rolls back, so does its audit row, and the trail can
 * never claim something happened when it did not.
 *
 * The actor is taken from the authenticated request (`req.user`), never from
 * the request body: a client must not be able to attribute an action to someone
 * else.
 */
import * as auditRepo from '../../repositories/audit.repository.js';

/**
 * @param {object} db transaction executor
 * @param {{ id?: string, email?: string }|null} actor the authenticated admin
 * @param {{ action: string, entityType: string, entityId?: string|null,
 *           summary?: string, changes?: object|null }} entry
 */
export async function recordAudit(db, actor, entry) {
  await auditRepo.insertAuditLog(db, {
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? null,
    changes: entry.changes ?? null,
  });
}

export default { recordAudit };
