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
 *   - pool → a dedicated client from `withTransaction`, adapted by
 *     `toExecutor` because `pg` keeps `query` on the prototype.
 *
 * The callback always receives an executor-shaped object with `.query`.
 */
import { withTransaction } from '../config/db.js';

/**
 * Adapts a `pg` client to the executor shape repositories call.
 *
 * `Client.prototype.query` is a prototype method, so reading `client.query` off
 * the client detaches it: repositories do `db?.query ?? poolQuery` and invoke the
 * result, which would run with `this === undefined` and throw
 * `Cannot read properties of undefined (reading '_Promise')`. A plain object
 * whose `query` closes over the client keeps the receiver intact and changes
 * nothing else — the statement still runs on that connection, inside the
 * transaction.
 *
 * @param {{ query: Function }} client a `pg` client from `withTransaction`
 * @returns {{ query: (text: string, params?: unknown[]) => Promise<object> }}
 */
export function toExecutor(client) {
  return { query: (text, params = []) => client.query(text, params) };
}

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

  // The pool hands back a raw client; wrap it so the repositories' extracted
  // `db.query` still has its receiver.
  return withTransaction((client) => callback(toExecutor(client)));
}

export default runInTransaction;
