import pg from 'pg';
import env from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

/**
 * A single PostgreSQL connection pool is created per process.
 * - Reuses connections to avoid TCP handshakes
 * - Parameterized queries must be used everywhere
 * - All clients must use `query()` or `withTransaction()`
 */
const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionString: env.DATABASE_URL?.trim() ? env.DATABASE_URL.trim() : undefined,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  ssl:
    env.DB_SSL === true
      ? {
          rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
        }
      : false,
});

/**
 * Logs connection pool lifecycle events once during startup to help with
 * debugging (environment, host/port/database name). Never logs credentials.
 */
function logPoolConfig() {
  if (env.isTest) return;
  logger.info('PostgreSQL pool configured', {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    max: env.DB_POOL_MAX,
    ssl: env.DB_SSL,
  });
}

logPoolConfig();

pool.on('connect', () => {
  if (env.isDevelopment) {
    logger.debug('PostgreSQL client connected');
  }
});

pool.on('error', (err) => {
  // Connection pool errors are often recoverable. Log and let the process crash
  // intentionally in production if the pool becomes unusable.
  logger.error('PostgreSQL pool error', err);
});

/** Execute a parameterized query against the pool. */
export async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const durationMs = Date.now() - start;
    if (env.isDevelopment) {
      logger.debug('pg.query executed', {
        durationMs,
        rowCount: result.rowCount,
        command: result.command,
      });
    }
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    logger.error('pg.query failed', { durationMs, error: error.message, text: text.slice(0, 80) });
    throw error;
  }
}

/** Acquire a client, run a callback inside a transaction, and release it. */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.warn('Transaction rollback failed', { error: rollbackError.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Performs a lightweight health check against PostgreSQL.
 * Returns `{ ok: boolean, latencyMs: number, error?: string }`.
 */
export async function healthCheck() {
  const start = Date.now();
  try {
    const result = await pool.query('SELECT 1 AS healthy');
    const latencyMs = Date.now() - start;
    const ok = result?.rows?.[0]?.healthy === 1;
    return { ok, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: error.message };
  }
}

/** Gracefully end the pool (useful for tests and shutdown hooks). */
export async function closePool() {
  await pool.end();
}

export { pool };

export default { pool, query, withTransaction, healthCheck, closePool };
