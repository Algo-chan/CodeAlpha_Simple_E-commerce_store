/**
 * Session repository — storage for authenticated browser sessions.
 *
 * Only SHA-256 hashes of tokens are ever persisted. Cancelling a session is a
 * DELETE, which makes logout immediate and unforgeable: there is no
 * not-yet-revoked window to argue about, and no shared secret to rotate.
 */
import crypto from 'node:crypto';
import { query as poolQuery } from '../config/db.js';

function executor(db) {
  return db.query ?? poolQuery;
}

/**
 * @param {string} token raw base64url token from the cookie
 * @returns {string} lower-case hex sha256
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * @param {object} [db]
 * @param {{ userId: string, tokenHash: string, expiresAt: Date, userAgent: string|null,
 *           ipAddress: string|null }} input
 */
export async function create(db, { userId, tokenHash, expiresAt, userAgent, ipAddress }) {
  const result = await executor(db)(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, token_hash, expires_at`,
    [userId, tokenHash, expiresAt, userAgent, ipAddress]
  );
  return result.rows[0];
}

/**
 * Finds a fresh session. Joins the owner user so a single round trip answers
 * "is this session valid and who does it belong to".
 *
 * @param {object} [db]
 * @param {string} tokenHash
 * @returns {Promise<{ session: object|null, user: object|null }>}
 */
export async function findByTokenHash(db, tokenHash) {
  const result = await executor(db)(
    `SELECT s.id        AS session_id,
            s.token_hash AS session_token_hash,
            s.expires_at AS session_expires_at,
            u.*
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash]
  );
  const row = result.rows[0] ?? null;
  if (!row) return { session: null, user: null };

  return {
    session: {
      id: row.session_id,
      tokenHash: row.session_token_hash,
      expiresAt: row.session_expires_at,
    },
    user: row,
  };
}

/**
 * @param {object} [db]
 * @param {string} tokenHash
 * @returns {Promise<boolean>} whether a row was deleted
 */
export async function deleteByTokenHash(db, tokenHash) {
  const result = await executor(db)(`DELETE FROM user_sessions WHERE token_hash = $1`, [tokenHash]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Revokes every session for a user except the one to keep — used when a
 * password changes so a leaked token on another device stops working.
 *
 * @param {object} [db]
 * @param {string} userId
 * @param {string|null} keepTokenHash the current session survives
 */
export async function deleteAllForUser(db, userId, keepTokenHash = null) {
  await executor(db)(
    `DELETE FROM user_sessions
      WHERE user_id = $1
        AND ($2::text IS NULL OR token_hash <> $2)`,
    [userId, keepTokenHash ?? null]
  );
}

export default { hashToken, create, findByTokenHash, deleteByTokenHash, deleteAllForUser };
