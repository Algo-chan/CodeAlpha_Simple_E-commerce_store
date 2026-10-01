/**
 * Creates the PostgreSQL database if it does not exist.
 *
 * Usage: npm run db:create
 *
 * Connects to the default `postgres` maintenance database (DATABASE_URL is
 * ignored here on purpose — we need to create the target database itself).
 */
import pg from 'pg';
import env from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

const { Client } = pg;

async function databaseExists(client, name) {
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return rows.length > 0;
}

async function main() {
  const target = env.DB_NAME;
  const client = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  });

  await client.connect();

  try {
    if (await databaseExists(client, target)) {
      logger.info(`Database "${target}" already exists.`);
      return;
    }

    // Identifier cannot be parameterized; it comes from our own validated env.
    await client.query(`CREATE DATABASE "${target.replace(/"/g, '""')}"`);
    logger.info(`Database "${target}" created.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  logger.error(`Could not create the database: ${error.message}`);
  logger.error('Check DB_HOST / DB_PORT / DB_USER / DB_PASSWORD in your .env file.');
  process.exitCode = 1;
});
