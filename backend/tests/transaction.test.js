/**
 * The executor contract that `runInTransaction` promises its callbacks.
 *
 * Repositories never call `pool` or `client` directly — they do
 * `const execute = db.query ?? poolQuery;` and invoke the result. That only
 * works while `query` keeps its receiver: `pg` defines it on the prototype, so
 * a bare reference runs with `this === undefined` and throws
 * `Cannot read properties of undefined (reading '_Promise')`.
 *
 * This is invisible to the API suites, which always inject an executor-shaped
 * `req.db`. Production injects nothing, so `runInTransaction` takes the pool
 * branch and every transactional write — cart, checkout, wishlist, and the
 * whole admin catalogue — would hit it. These tests pin both halves: that the
 * detached call really is the bug, and that `toExecutor` prevents it.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTransaction, toExecutor } from '../src/utils/transaction.js';

/**
 * Stands in for `pg.Client`: `query` exists only on the prototype, and it
 * dereferences `this` the way pg's own `query` does.
 */
class FakeClient {
  constructor() {
    this.calls = [];
  }

  query(text, params) {
    if (this === undefined) {
      throw new TypeError("Cannot read properties of undefined (reading '_Promise')");
    }
    this.calls.push({ text, params });
    return { rows: [], rowCount: 1 };
  }
}

test('a bare reference to client.query drops the receiver', () => {
  const client = new FakeClient();
  const detached = client.query;

  assert.throws(() => detached('SELECT 1'), TypeError);
  assert.equal(client.calls.length, 0);
});

test('toExecutor keeps the receiver through the repositories’ extraction', () => {
  const client = new FakeClient();
  const tx = toExecutor(client);

  // The exact shape repository helpers use: `db.query ?? poolQuery`.
  const execute = tx.query;
  const result = execute('SELECT $1', [7]);

  assert.equal(result.rowCount, 1);
  assert.deepEqual(client.calls, [{ text: 'SELECT $1', params: [7] }]);
});

test('toExecutor defaults omitted params to an empty array', () => {
  const client = new FakeClient();

  toExecutor(client).query('COMMIT');

  assert.deepEqual(client.calls, [{ text: 'COMMIT', params: [] }]);
});

test('runInTransaction runs BEGIN/COMMIT through an injected executor', async () => {
  const statements = [];
  const db = {
    query: async (text) => {
      statements.push(text);
      return { rows: [] };
    },
  };

  const outcome = await runInTransaction(db, async (tx) => {
    await tx.query('SELECT 1');
    return 'committed';
  });

  assert.equal(outcome, 'committed');
  assert.deepEqual(statements, ['BEGIN', 'SELECT 1', 'COMMIT']);
});

test('runInTransaction rolls back a callback that throws', async () => {
  const statements = [];
  const db = {
    query: async (text) => {
      statements.push(text);
      return { rows: [] };
    },
  };

  await assert.rejects(
    runInTransaction(db, async (tx) => {
      await tx.query('SELECT 1');
      throw new Error('boom');
    }),
    /boom/
  );

  assert.deepEqual(statements, ['BEGIN', 'SELECT 1', 'ROLLBACK']);
});
