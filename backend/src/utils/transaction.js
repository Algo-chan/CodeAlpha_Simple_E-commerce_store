/**
 * Transaction helper that works with both database contexts.
 *
 * The app hands controllers an optional `req.db` executor: tests inject a
 * single-connection PGlite, production injects nothing and repositories fall
 * back to the pg pool. Multi-statement cart operations (lock, validate, write)
 * need atomicity in both worlds:
 *
 *   - injected executor → BEGIN/COMMIT/ROLLBACK on that same connection, which
 *     is safe because it is a single connection;
 *   - pool → a dedicated client from `withTransaction`, whose `.query` looks
 *     exactly like an executor, so repositories accept it unchanged.
 *
 * The callback always receives an executor-shaped object with `.query`.
 */
import { withTransaction } from '../config/db.js';

/**
 * @param {object|undefined} db request-scoped executor (may be undefined)
 * @param {(db: {query: Function}) => Promise<any>} callback
 * @returns {Promise<any>}
 */
export async function runInTransaction(db, callback) {
  if (db && typeof db.query === 'function') {
    await db.query('BEGIN');
    try {
      const result = await callback(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch {
        /* a failed rollback must not mask the original error */
      }
      throw error;
    }
  }

  return withTransaction(callback);
}

export default runInTransaction;
