/**
 * Database access helpers used by repositories.
 *
 * IMPORTANT: every query in this project must be parameterized
 * (`WHERE id = $1`) — never build SQL with string concatenation.
 * This protects against SQL injection.
 */
import { pool } from '../config/db.js';

/**
 * Runs a parameterized SELECT query.
 * @param {string} text - SQL text containing $1, $2, ... placeholders.
 * @param {unknown[]} [params] - Values bound to the placeholders.
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function select(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

/**
 * Runs a parameterized INSERT/UPDATE/DELETE inside a transaction.
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function execute(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

/**
 * Executes `callback` with a dedicated client wrapped in BEGIN/COMMIT/ROLLBACK.
 * Used when several queries must succeed or fail together.
 *
 * @param {(client: import('pg').PoolClient) => Promise<unknown>} callback
 */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lightweight connectivity probe used by the health check.
 * @returns {Promise<{ ok: boolean, latencyMs: number }>}
 */
export async function ping() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return { ok: true, latencyMs: Date.now() - start };
}

export default { select, execute, withTransaction, ping };
