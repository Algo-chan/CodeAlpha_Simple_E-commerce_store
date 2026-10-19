/**
 * Bootstrap administrator.
 *
 * A store on a shell-less host (Render's free plan) has no way to promote an
 * account with SQL, so the first administrator comes from `BOOTSTRAP_ADMIN_*`
 * via `backend/scripts/bootstrap-admin.js` → `ensureBootstrapAdmin`.
 *
 * That makes these the rules worth pinning down: the account is an ACTIVE ADMIN,
 * the password is stored hashed rather than in plain text, an existing account
 * is promoted rather than duplicated, and re-running converges instead of
 * piling up rows. The script runs on every boot, so "converges" is the property
 * the deployment depends on most.
 */
import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedDb } from './helpers/database.js';
import { ensureBootstrapAdmin } from '../src/services/admin-bootstrap.service.js';
import { verifyPassword } from '../src/services/password.js';
import * as users from '../src/repositories/user.repository.js';

let pg; // the PGlite instance (owns close)
let db; // the executor the repository accepts

before(async () => {
  pg = await createMigratedDb();
  db = { query: (text, params = []) => pg.query(text, params) };
});

after(async () => {
  await pg?.close();
});

/** Counts user rows, so a duplicate insert cannot pass unnoticed. */
async function countUsers() {
  const { rows } = await pg.query('SELECT count(*)::int AS n FROM users');
  return rows[0].n;
}

test('creates an ACTIVE ADMIN and stores the password hashed', async () => {
  const email = 'first-admin@example.com';
  const password = 'Bootstrap-1!pass';

  const { created, user } = await ensureBootstrapAdmin(db, {
    name: 'Store Admin',
    email,
    password,
  });

  assert.equal(created, true);
  assert.equal(user.role, 'ADMIN');
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.email, email);
  assert.equal(user.phone, null);

  // The plaintext must never reach the row, and the stored value must still
  // verify — a hash that cannot be compared is no better than a broken one.
  assert.notEqual(user.password_hash, password);
  assert.match(user.password_hash, /^\$[0-9a-z]{1,4}\$/);
  assert.equal(await verifyPassword(password, user.password_hash), true);
});

test('normalises the email the way the schema requires', async () => {
  const { user } = await ensureBootstrapAdmin(db, {
    name: 'Store Admin',
    email: '  Mixed.Case@Example.COM  ',
    password: 'Bootstrap-2!pass',
  });

  // The `users_email_format` CHECK accepts only `email = LOWER(BTRIM(email))`,
  // so an unnormalised input would fail here rather than in the database.
  assert.equal(user.email, 'mixed.case@example.com');
});

test('promotes an existing customer instead of duplicating it', async () => {
  const email = 'shopper@example.com';
  const shopper = await users.create(db, {
    name: 'Shopper',
    email,
    phone: '0911000000',
    // Any modular-crypt string satisfies the CHECK; this one is never compared.
    passwordHash: '$2b$04$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(shopper.role, 'CUSTOMER');

  const before = await countUsers();

  const { created, user } = await ensureBootstrapAdmin(db, {
    name: 'Promoted Shopper',
    email,
    password: 'Bootstrap-3!pass',
  });

  assert.equal(created, false);
  assert.equal(user.id, shopper.id);
  assert.equal(user.role, 'ADMIN');
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.name, 'Promoted Shopper');
  assert.equal(await countUsers(), before);

  // The configured password replaces the old one, which is what makes this a
  // recovery path for a lost administrator password.
  assert.equal(await verifyPassword('Bootstrap-3!pass', user.password_hash), true);
});

test('converges: a second run keeps one row and the same account', async () => {
  const email = 'repeat-admin@example.com';
  const input = { name: 'Store Admin', email, password: 'Bootstrap-4!pass' };

  const first = await ensureBootstrapAdmin(db, input);
  const second = await ensureBootstrapAdmin(db, input);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.user.id, first.user.id);

  const { rows } = await pg.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [email]);
  assert.equal(rows[0].n, 1);
});

test('refuses a password that fails the registration policy', async () => {
  const email = 'weak-admin@example.com';

  await assert.rejects(
    () => ensureBootstrapAdmin(db, { name: 'Store Admin', email, password: 'short' }),
    /Invalid bootstrap administrator configuration/
  );

  // Nothing is written when validation fails, so a bad value cannot leave a
  // half-created administrator behind.
  const { rows } = await pg.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [email]);
  assert.equal(rows[0].n, 0);
});

test('rejects an email that is not an email address', async () => {
  await assert.rejects(
    () =>
      ensureBootstrapAdmin(db, {
        name: 'Store Admin',
        email: 'not-an-email',
        password: 'Bootstrap-5!pass',
      }),
    /Invalid bootstrap administrator configuration/
  );
});

test('stores exactly one layer of bcrypt, never a double hash', async () => {
  const { user } = await ensureBootstrapAdmin(db, {
    name: 'Store Admin',
    email: 'ordered-admin@example.com',
    password: 'Bootstrap-6!pass',
  });

  // Two `$2b$` prefixes would mean the service hashed an already-hashed value.
  assert.equal(user.password_hash.match(/\$2[aby]\$/g)?.length, 1);
  // bcrypt format: $2b$<cost>$<22-char salt><31-char digest> — four `$`-parts.
  assert.equal(user.password_hash.split('$').length, 4);
  assert.equal(await verifyPassword('Bootstrap-6!pass', user.password_hash), true);
});
