/**
 * Address repository — the only place allowed to run address SQL.
 *
 * Default-address swaps (set-default, delete + promote) need two conflicting
 * writes, so they use patterns the executor accepts without transaction
 * plumbing (an in-process PGlite in tests, the pool in production): a single
 * UPDATE can clear-and-claim because Postgres lets one statement swap unique
 * values, and the partial unique index hard-fails a racing promote rather than
 * ever leaving two defaults.
 */

import { query as poolQuery } from '../config/db.js';

function executor(db) {
  return db.query ?? poolQuery;
}

/** Always returns the full row so the service can hand it straight back. */
const COLUMNS = `
  id, user_id, label, full_name, phone, city, area, street, landmark,
  additional_notes, is_default, created_at, updated_at`;

/**
 * @param {object} [db]
 * @param {string} userId
 */
export async function listByUser(db, userId) {
  const result = await executor(db)(
    `SELECT ${COLUMNS}
       FROM addresses
      WHERE user_id = $1
      ORDER BY is_default DESC, created_at ASC, id ASC`,
    [userId]
  );
  return result.rows;
}

/**
 * @param {object} [db]
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function findById(db, id, userId) {
  const result = await executor(db)(
    `SELECT ${COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Inserts an address. The first address a customer adds becomes the default;
 * later ones start as non-default (the unique partial index enforces that only
 * one default can exist). `label` defaults to 'Default' to match the column.
 *
 * Field names match the API body (snake_case), so the service can forward the
 * validated payload unchanged.
 *
 * @param {object} [db]
 * @param {{ userId: string, label?: string, full_name: string, phone: string,
 *           city: string, area: string, street: string,
 *           landmark?: string, additional_notes?: string }} input
 */
export async function create(db, input) {
  const {
    userId,
    label = 'Default',
    full_name,
    phone,
    city,
    area,
    street,
    landmark = null,
    additional_notes = null,
  } = input;

  const result = await executor(db)(
    `INSERT INTO addresses
       (user_id, label, full_name, phone, city, area, street, landmark, additional_notes, is_default)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
            NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1)
     RETURNING ${COLUMNS}`,
    [userId, label, full_name, phone, city, area, street, landmark, additional_notes]
  );
  return result.rows[0] ?? null;
}

/**
 * Updates an address. Only the caller-supplied fields change and `is_default`
 * is never touched here — promoting a default is `setDefault`'s job, so editing
 * cannot silently un-default a delivery address.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {string} userId
 * @param {{ label?: string, full_name?: string, phone?: string, city?: string,
 *           area?: string, street?: string, landmark?: string|null,
 *           additional_notes?: string|null }} fields
 * @returns {Promise<object|null>}
 */
export async function update(db, id, userId, fields) {
  const result = await executor(db)(
    `UPDATE addresses
        SET label             = COALESCE($3, label),
            full_name         = COALESCE($4, full_name),
            phone             = COALESCE($5, phone),
            city              = COALESCE($6, city),
            area              = COALESCE($7, area),
            street            = COALESCE($8, street),
            landmark          = COALESCE($9, landmark),
            additional_notes  = COALESCE($10, additional_notes)
      WHERE id = $1 AND user_id = $2
      RETURNING ${COLUMNS}`,
    [
      id,
      userId,
      fields.label ?? null,
      fields.full_name ?? null,
      fields.phone ?? null,
      fields.city ?? null,
      fields.area ?? null,
      fields.street ?? null,
      fields.landmark ?? null,
      fields.additional_notes ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

/**
 * Deletes an address. When the deleted row was the default and another address
 * remains, the oldest remaining one is promoted right after, so the invariant
 * "exactly one default while addresses exist" is usually restored in one call.
 *
 * The delete and the promotion are two statements rather than two data-modifying
 * CTEs because WITH sub-statements run concurrently and cannot see each other's
 * effects (the promote would either miss the deletion or hit the unique index).
 * The partial unique index is the safety net: a racing double-promotion fails
 * loudly as a CONFLICT instead of leaving two defaults.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>} the deleted row
 */
export async function remove(db, id, userId) {
  const result = await executor(db)(
    `DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId]
  );
  const deleted = result.rows[0] ?? null;
  if (!deleted) return null;

  if (deleted.is_default) {
    await executor(db)(
      `UPDATE addresses
          SET is_default = TRUE
        WHERE user_id = $1
          AND id = (
            SELECT a.id
              FROM addresses a
             WHERE a.user_id = $1
             ORDER BY a.created_at ASC, a.id ASC
             LIMIT 1
          )`,
      [userId]
    );
  }

  return deleted;
}

/**
 * Sets an address as the customer's default. One statement clears every other
 * default in the same pass (is_default = (id = $1)) instead of a "clear then
 * set" pair of CTEs, which Postgres evaluates concurrently and which therefore
 * races on the partial unique index. A single UPDATE may swap unique values
 * because the conflicting row is modified by the same statement.
 *
 * Returns the row when the address belongs to the customer, otherwise null.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function setDefault(db, id, userId) {
  const result = await executor(db)(
    `WITH applied AS (
       UPDATE addresses
          SET is_default = (id = $1)
        WHERE user_id = $2
          AND EXISTS (SELECT 1 FROM addresses WHERE id = $1 AND user_id = $2)
        RETURNING ${COLUMNS}
     )
     SELECT ${COLUMNS} FROM applied WHERE id = $1`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

export default { listByUser, findById, create, update, remove, setDefault };
