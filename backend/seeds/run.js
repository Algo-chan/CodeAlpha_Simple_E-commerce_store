/**
 * Seed runner — loads demo data for local development.
 *
 * Usage:
 *   node seeds/run.js            # run every *.seed.js file in order
 *   node seeds/run.js --only=01_users
 *
 * A seed file must export a default async function:
 *
 *   export default async function up({ client, query }) {
 *     await query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING', ['Audio']);
 *   }
 *
 * Each file runs inside its own transaction, so a failing seed is rolled back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';

const SEEDS_DIR = path.dirname(fileURLToPath(import.meta.url));

function loadSeedFiles(only) {
  return fs
    .readdirSync(SEEDS_DIR)
    .filter((file) => file.endsWith('.seed.js'))
    .filter((file) => (only ? file.includes(only) : true))
    .sort()
    .map((name) => ({ name, path: path.join(SEEDS_DIR, name) }));
}

async function run() {
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1] : null;
  const files = loadSeedFiles(only);

  if (files.length === 0) {
    logger.info(
      only
        ? `No seed files matched "${only}".`
        : 'No seed files found yet. Demo data will be added when the schema exists.'
    );
    return;
  }

  logger.info(`Running ${files.length} seed file(s)...`);

  for (const file of files) {
    const module = await import(file.path);
    const seedFn = module.default;

    if (typeof seedFn !== 'function') {
      throw new Error(`Seed file "${file.name}" must export a default function.`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedFn({
        client,
        /** Parameterized query helper bound to the transaction's client. */
        query: (text, params = []) => client.query(text, params),
      });
      await client.query('COMMIT');
      logger.info(`Seeded ${file.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Seed "${file.name}" failed: ${error.message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  logger.info('Seeding complete.');
}

run()
  .catch((error) => {
    logger.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
