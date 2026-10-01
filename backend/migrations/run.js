/**
 * Migration runner.
 *
 * Usage:
 *   node migrations/run.js up       # apply pending migrations
 *   node migrations/run.js status   # list applied / pending migrations
 *
 * Rules:
 * - Files are named `001_description.sql` and applied in ascending order.
 * - Each file runs inside a transaction; a failure rolls the file back.
 * - Already-applied files are skipped (tracked in `schema_migrations`).
 * - Never edit an applied migration — add a new one instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';

const MIGRATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACKING_TABLE = 'schema_migrations';

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL UNIQUE,
      checksum    VARCHAR(64)  NOT NULL,
      applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { name, sql, checksum };
    });
}

async function getAppliedMigrations() {
  const { rows } = await pool.query(
    `SELECT name, checksum, applied_at FROM ${TRACKING_TABLE} ORDER BY name`
  );
  return new Map(rows.map((row) => [row.name, row]));
}

async function runUp() {
  await ensureTrackingTable();

  const files = loadMigrationFiles();
  const applied = await getAppliedMigrations();
  const pending = files.filter((file) => !applied.has(file.name));

  if (pending.length === 0) {
    logger.info(`Database is up to date (${files.length} migration(s) applied).`);
    return;
  }

  logger.info(`Applying ${pending.length} migration(s)...`);

  for (const migration of pending) {
    const existing = applied.get(migration.name);
    if (existing && existing.checksum !== migration.checksum) {
      logger.warn(
        `Migration "${migration.name}" was modified after being applied. ` +
          'Create a new migration instead of editing history.'
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(`INSERT INTO ${TRACKING_TABLE} (name, checksum) VALUES ($1, $2)`, [
        migration.name,
        migration.checksum,
      ]);
      await client.query('COMMIT');
      logger.info(`Applied ${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Failed to apply ${migration.name}: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  logger.info('Migrations complete.');
}

async function runStatus() {
  await ensureTrackingTable();

  const files = loadMigrationFiles();
  const applied = await getAppliedMigrations();

  logger.info('Migration status:');
  for (const file of files) {
    const record = applied.get(file.name);
    logger.info(
      `  ${record ? '[x]' : '[ ]'} ${file.name}${record ? ` (applied ${record.applied_at.toISOString?.() ?? record.applied_at})` : ''}`
    );
  }

  if (files.length === 0) {
    logger.info('  (no migration files yet — the schema will be designed in a later phase)');
  }
}

async function main() {
  const command = process.argv[2] ?? 'up';

  try {
    if (command === 'up') await runUp();
    else if (command === 'status') await runStatus();
    else throw new Error(`Unknown command "${command}". Use "up" or "status".`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  logger.error(error.message);
  process.exit(1);
});
