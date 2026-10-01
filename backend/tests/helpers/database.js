/**
 * Shared harness for database tests.
 *
 * `npm test` must pass on a machine with no PostgreSQL server installed, so
 * these tests run against PGlite — a real PostgreSQL compiled to WebAssembly —
 * instead of `pg`. The DDL and the seed logic under test are byte-for-byte the
 * files the real runner applies, so this is a genuine execution of the schema
 * rather than a mock.
 *
 * When a server is available, `npm run migrate && npm run seed` exercises the
 * same files over the wire; these tests cover the parts a migration run cannot:
 * that the constraints reject bad data, and that the seeds converge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(HERE, '../../migrations');
export const SEEDS_DIR = path.resolve(HERE, '../../seeds');

/** Migration files in the order the runner applies them. */
export function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/** Seed files in the order the runner applies them. */
export function listSeeds() {
  return fs
    .readdirSync(SEEDS_DIR)
    .filter((file) => file.endsWith('.seed.js'))
    .sort();
}

/**
 * Create a database with every migration applied.
 *
 * Each migration runs in its own transaction, mirroring `migrations/run.js`.
 *
 * @returns {Promise<import('@electric-sql/pglite').PGlite>}
 */
export async function createMigratedDb() {
  const db = await PGlite.create();

  for (const file of listMigrations()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }

  return db;
}

/**
 * Create a database with every migration and seed applied.
 *
 * @returns {Promise<import('@electric-sql/pglite').PGlite>}
 */
export async function createSeededDb() {
  const db = await createMigratedDb();
  await runSeeds(db);
  return db;
}

/**
 * Run every seed file against an already-migrated database.
 *
 * Each file gets its own transaction and the same `query` helper the real
 * runner passes, so a seed cannot accidentally rely on running outside a
 * transaction.
 *
 * @param {import('@electric-sql/pglite').PGlite} db
 */
export async function runSeeds(db) {
  for (const file of listSeeds()) {
    const module = await import(pathToFileURL(path.join(SEEDS_DIR, file)).href);
    await db.exec('BEGIN');
    try {
      await module.default({
        client: db,
        query: async (text, params = []) => db.query(text, params),
      });
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw new Error(`Seed ${file} failed: ${error.message}`, { cause: error });
    }
  }
}

/**
 * Assert that a statement is rejected by the database.
 *
 * A constraint that silently accepts bad data is worse than a missing one, so
 * every rule in the schema is tested by trying to break it. The error is
 * matched loosely against `expected` so the test does not depend on the exact
 * wording of a PostgreSQL error message.
 *
 * @param {import('@electric-sql/pglite').PGlite} db
 * @param {string} sql
 * @param {Array<unknown>} [params]
 * @param {RegExp} [expected] Substring or pattern the error must mention.
 */
export async function expectRejected(db, sql, params = [], expected) {
  let error;
  try {
    await db.query(sql, params);
  } catch (caught) {
    error = caught;
  }

  if (!error) {
    throw new Error(`Statement was accepted but should have been rejected:\n  ${sql}`);
  }

  if (expected && !expected.test(error.message)) {
    throw new Error(
      `Rejected, but not for the expected reason.\n  expected: ${expected}\n  actual:   ${error.message}`,
      { cause: error }
    );
  }

  return error;
}

/**
 * Fingerprint a table's business data, ignoring `created_at` and `updated_at`.
 *
 * Those two move legitimately: re-running the seeds upserts the same rows, so
 * each run fires the `updated_at` trigger, and rows with no story date are
 * stamped with the insertion time. Anything else must not change.
 *
 * @param {import('@electric-sql/pglite').PGlite} db
 * @param {string} table
 * @returns {Promise<{ n: number, h: string }>}
 */
export async function fingerprint(db, table) {
  const { rows: columns } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
        AND column_name NOT IN ('created_at', 'updated_at')
      ORDER BY ordinal_position`,
    [table]
  );
  const expr = columns
    .map((column) => `COALESCE(t."${column.column_name}"::text, '<null>')`)
    .join(", '|', ");

  const { rows } = await db.query(
    `SELECT count(*)::int AS n,
            COALESCE(sum(hashtext(concat_ws('|', ${expr}))), 0)::bigint AS h
       FROM ${table} t`
  );
  return rows[0];
}
