/**
 * Address repository — the only place allowed to run address SQL.
 *
 * All statements are single-statement writable CTEs. The "one default per user"
 * partial unique index makes default-promotion inherently multi-row, but doing
 * it in ONE statement keeps it atomic even through an executor that has no
 * transaction plumbing (an in-process PGlite in tests, the pool in production).
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
 * @param {object} [db]
 * @param {{ userId: string, label?: string, fullName: string, phone: string,
 *           city: string, area: string, street: string,
 *           landmark?: string, additionalNotes?: string }} input
 */
export async function create(db, input) {
  const {
    userId,
    label = 'Default',
    fullName,
    phone,
    city,
    area,
    street,
    landmark = null,
    additionalNotes = null,
  } = input;

  const result = await executor(db)(
    `INSERT INTO addresses
       (user_id, label, full_name, phone, city, area, street, landmark, additional_notes, is_default)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
            NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1)
     RETURNING ${COLUMNS}`,
    [userId, label, fullName, phone, city, area, street, landmark, additionalNotes]
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
 * @param {{ label?: string, fullName?: string, phone?: string, city?: string,
 *           area?: string, street?: string, landmark?: string|null,
 *           additionalNotes?: string|null }} fields
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
      fields.fullName ?? null,
      fields.phone ?? null,
      fields.city ?? null,
      fields.area ?? null,
      fields.street ?? null,
      fields.landmark ?? null,
      fields.additionalNotes ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

/**
 * Deletes an address. When the deleted row was the default and another address
 * remains, the oldest remaining one is promoted in the same statement, so the
 * invariant "exactly one default while addresses exist" never needs a second,
 * non-atomic round trip.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>} the deleted row
 */
export async function remove(db, id, userId) {
  const result = await executor(db)(
    `WITH deleted AS (
       DELETE FROM addresses
        WHERE id = $1 AND user_id = $2
        RETURNING *
     ),
     promote AS (
       UPDATE addresses
          SET is_default = TRUE
        WHERE user_id = $2
          AND EXISTS (SELECT 1 FROM deleted WHERE is_default)
          AND id = (
            SELECT a.id
              FROM addresses a
             WHERE a.user_id = $2
             ORDER BY a.created_at ASC, a.id ASC
             LIMIT 1
          )
       RETURNING 1
     )
     SELECT id, user_id, label, full_name, phone, city, area, street, landmark,
            additional_notes, is_default, created_at, updated_at
       FROM deleted`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Sets an address as the customer's default, atomically clearing any previous
 * default in the same statement. Returns the row when the address belongs to
 * the customer, otherwise null.
 *
 * @param {object} [db]
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function setDefault(db, id, userId) {
  const result = await executor(db)(
    `WITH target AS (
       SELECT id FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE
     ),
     cleared AS (
       UPDATE addresses
          SET is_default = FALSE
        WHERE user_id = $2 AND is_default AND id <> $1
          AND EXISTS (SELECT 1 FROM target)
       RETURNING 1
     ),
     promoted AS (
       UPDATE addresses
          SET is_default = TRUE
        WHERE id = $1 AND user_id = $2
       RETURNING ${COLUMNS}
     )
     SELECT id, user_id, label, full_name, phone, city, area, street, landmark,
            additional_notes, is_default, created_at, updated_at
       FROM promoted`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

export default { listByUser, findById, create, update, remove, setDefault };