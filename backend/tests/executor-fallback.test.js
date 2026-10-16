/**
 * The executor fallback contract.
 *
 * Repositories resolve their database handle with
 *
 *   const execute = db?.query ?? poolQuery;
 *
 * The optional chaining is load-bearing. Production passes no `req.db`, and
 * most services do not default it, so the raw `undefined` reaches the
 * repository. Without the `?.` this reads `query` off `undefined` and throws
 *
 *   TypeError: Cannot read properties of undefined (reading 'query')
 *
 * which the production error handler flattens to an opaque "Internal server
 * error" — so registration, login, the account surface, orders, the wishlist
 * and the whole admin API all returned 500 in production while the suite stayed
 * green.
 *
 * The suite stayed green because every API test injects an executor-shaped
 * `req.db`; the undefined case is unreachable from them. These tests pin the
 * contract directly instead: the source shape (so the pattern cannot drift
 * back) and the runtime behaviour (so the fallback actually happens).
 */
import './setup.js';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as users from '../src/repositories/user.repository.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../src');

/** Every `.js` file under `src/`, so a new repository is covered on day one. */
function listSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * The unguarded fallback: `db.query ?? poolQuery` with no optional chaining.
 * Matches only the fallback idiom, not guarded uses such as
 * `if (db && typeof db.query === 'function')` or `db.query('BEGIN')`.
 */
const UNGUARDED_FALLBACK = /\bdb\.query\s*\?\?\s*poolQuery/;

test('no source file resolves the pool with an unguarded db.query', () => {
  const offenders = [];
  for (const file of listSources(SRC_DIR)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (UNGUARDED_FALLBACK.test(line)) {
        offenders.push(`${path.relative(SRC_DIR, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `these resolve the pool off a possibly-undefined db, which throws in production:\n${offenders.join('\n')}`
  );
});

test('a repository tolerates an undefined db (the production shape)', async () => {
  // `findByEmail` is a read, so falling through to the pool is harmless: with a
  // server reachable it returns null for an unknown address, without one it
  // fails on the connection. Both are fine; a TypeError is the bug.
  let error;
  try {
    await users.findByEmail(undefined, 'nobody@example.invalid');
  } catch (caught) {
    error = caught;
  }

  if (error !== undefined) {
    assert.ok(
      !(error instanceof TypeError),
      `undefined db must fall back to the pool, not throw a TypeError: ${error.message}`
    );
    assert.ok(
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|password|database|connect|terminat/i.test(error.message),
      `expected a connection-level failure, got: ${error.message}`
    );
  }
});

test('an empty executor (the catalogue default) still falls back to the pool', async () => {
  // `catalogue.service` defaults its db to `{}`; repositories must treat that
  // the same as `undefined`. This is the shape that always worked.
  let error;
  try {
    await users.findByEmail({}, 'nobody@example.invalid');
  } catch (caught) {
    error = caught;
  }
  assert.ok(
    !(error instanceof TypeError),
    `empty db must not throw a TypeError: ${error?.message}`
  );
});
