/**
 * User repository — the only place allowed to run user SQL.
 *
 * Follows the executor-injection rule from the catalogue repository: production
 * passes the `pg` pool, tests pass a PGlite instance, and every statement runs
 * as a bound parameter.
 */
import { query as poolQuery } from '../config/db.js';

/** Grounds a db executor, preferring an injected one. */
function executor(db) {
  return db.query ?? poolQuery;
}

/**
 * @param {object} [db]
 * @param {string} email normalised (lowercase) email
 * @returns {Promise<object|null>}
 */
export async function findByEmail(db, email) {
  const result = await executor(db)(
    `SELECT *
       FROM users
      WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * @param {object} [db]
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findById(db, id) {
  const result = await executor(db)(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

/**
 * Registers a new customer. Role and status are hard-wired here — callers never
 * choose them, and the schema whitelists the same values for defence in depth.
 *
 * @param {object} [db]
 * @param {{ name: string, email: string, phone: string, passwordHash: string }} input
 */
export async function create(db, { name, email, phone, passwordHash }) {
  const result = await executor(db)(
    `INSERT INTO users (name, email, phone, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'CUSTOMER', 'ACTIVE')
     RETURNING *`,
    [name, email, phone, passwordHash]
  );
  return result.rows[0];
}

/**
 * Updates profile fields. Only the two columns a customer may control are ever
 * touched; role/status/email are intentionally absent from this statement.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {{ name?: string, phone?: string }} fields
 */
export async function updateProfile(db, id, { name, phone }) {
  const result = await executor(db)(
    `UPDATE users
        SET name = COALESCE($2, name),
            phone = COALESCE($3, phone)
      WHERE id = $1
      RETURNING *`,
    [id, name ?? null, phone ?? null]
  );
  return result.rows[0] ?? null;
}

/**
 * Marks the successful login moment on the user row. Kept separate from
 * `updateProfile` because session creation must never touch profile fields.
 *
 * @param {object} [db]
 * @param {string} id
 */
export async function setLastLogin(db, id) {
  await executor(db)(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [
    id,
  ]);
}

/**
 * Replaces the password hash and stamps `password_changed_at` — used both when
 * the customer changes their own password and wherever a forced reset lands.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {string} passwordHash
 */
export async function updatePassword(db, id, passwordHash) {
  await executor(db)(
    `UPDATE users
        SET password_hash = $2,
            password_changed_at = NOW()
      WHERE id = $1`,
    [id, passwordHash]
  );
}

export default { findByEmail, findById, create, updateProfile, setLastLogin, updatePassword };
