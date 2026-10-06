/**
 * Authentication & customer account HTTP tests (Phase 6).
 *
 * These exercise the whole stack against a real PostgreSQL engine (PGlite):
 * routing, Zod validation, CSRF, the session cookie, bcrypt hashing, the SQL in
 * the user/session/address repositories, and the error envelope. It is the
 * place where "does login actually leak whether an email exists?" is answered,
 * not in prose.
 *
 * The session cookie is read straight off the response header, so tests hold
 * the implementation to its security attributes (HttpOnly, SameSite) the same
 * way a browser would.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import crypto from 'node:crypto';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';
import { createAuthLimiter } from '../src/middleware/security.js';
import env from '../src/config/env.js';

const COOKIE = 'ecom_session';

let db;
let app;

test.before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
});

test.after(async () => {
  await db?.close();
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

/** Extracts the raw session cookie value from a supertest response. */
function sessionValue(res) {
  const headers = res.headers['set-cookie'] ?? [];
  const list = Array.isArray(headers) ? headers : [headers];
  const entry = list.find((cookie) => cookie.startsWith(`${COOKIE}=`));
  if (!entry) return null;
  return { raw: entry, value: entry.slice(entry.indexOf('=') + 1).split(';')[0] };
}

/** Carries a session cookie on every subsequent request. */
function withSession(res) {
  const session = sessionValue(res);
  if (!session) return {};
  return { Cookie: session.raw };
}

const REGISTER_BODY = {
  name: 'Tigist Alemu',
  email: 'tigist@example.com',
  phone: '0911556677',
  password: 'StrongPass1!',
  passwordConfirmation: 'StrongPass1!',
};

async function register(body = REGISTER_BODY) {
  return request(app).post('/api/v1/auth/register').send(body);
}

async function login(email = REGISTER_BODY.email, password = REGISTER_BODY.password) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

/** Registers a fresh user and returns `{ res, cookie }`. */
async function createAccount(body = {}) {
  const res = await register({ ...REGISTER_BODY, ...body });
  return { res, cookie: withSession(res) };
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

test('registration creates an ACTIVE CUSTOMER, sets a session cookie, never returns a hash', async () => {
  const res = await register();

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.name, REGISTER_BODY.name);
  assert.equal(res.body.data.user.email, REGISTER_BODY.email);
  assert.equal(res.body.data.user.role, 'CUSTOMER');
  assert.equal(res.body.data.user.status, 'ACTIVE');
  assert.equal(res.body.data.user.password_hash, undefined);
  assert.equal(JSON.stringify(res.body).includes('password'), false, 'no mention of a password');

  const session = sessionValue(res);
  assert.ok(session, 'registration should start a session');
  assert.match(session.raw, /HttpOnly/, 'the session cookie must be HttpOnly');
  assert.match(session.raw, /SameSite=Lax/, 'SameSite=Lax for CSRF defence');
  assert.equal(
    JSON.stringify(res.body).includes('password_hash'),
    false,
    'the hash never leaves the server'
  );
});

test('the database stores only the sha-256 of the session token', async () => {
  const res = await login();
  const { value } = sessionValue(res);

  const fingerprint = crypto.createHash('sha256').update(value).digest('hex');
  const { rows } = await db.query(
    `SELECT token_hash FROM user_sessions ORDER BY created_at DESC LIMIT 1`
  );

  assert.equal(rows[0].token_hash, fingerprint, 'stored hash must match sha256(cookie)');
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rows[0].token_hash, value, 'the raw token must never be persisted');
});

test('registration normalises and lowercases the email', async () => {
  const res = await register({ ...REGISTER_BODY, email: '  MixedCase@Example.com ' });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.email, 'mixedcase@example.com');
});

test('a duplicate email is refused with 409 CONFLICT', async () => {
  await register({ ...REGISTER_BODY, email: 'dup@example.com' });
  const res = await register({ ...REGISTER_BODY, email: 'dup@example.com' });

  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('registration validation: missing fields, bad email, bad phone, weak password, mismatch', async () => {
  const cases = [
    { body: {}, field: 'name', why: 'all fields missing' },
    { body: { ...REGISTER_BODY, email: 'not-an-email' }, field: 'email' },
    { body: { ...REGISTER_BODY, phone: 'abc' }, field: 'phone' },
    { body: { ...REGISTER_BODY, phone: '0911' }, field: 'phone', why: 'too short' },
    { body: { ...REGISTER_BODY, password: 'short' }, field: 'password' },
    { body: { ...REGISTER_BODY, password: 'alllowercase1!' }, field: 'password' },
    {
      body: { ...REGISTER_BODY, passwordConfirmation: 'different1!' },
      field: 'passwordConfirmation',
    },
    { body: { ...REGISTER_BODY, name: ' ' }, field: 'name' },
  ];

  for (const { body, field, why } of cases) {
    const res = await register(body);
    assert.equal(res.status, 422, `should refuse (${why ?? field})`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      res.body.error.details.errors.some((error) => error.field === field && error.source === 'body'),
      `expected a body error on "${field}" (${why ?? ''})`
    );
  }
});

test('registration strips privileged fields sent in the body', async () => {
  const res = await register({
    ...REGISTER_BODY,
    email: 'stripped@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
    password_hash: 'stolen',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, 'CUSTOMER');
});

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

test('login returns the user and a session cookie', async () => {
  await register({ ...REGISTER_BODY, email: 'login@example.com' });

  const res = await login('login@example.com');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.email, 'login@example.com');
  assert.ok(sessionValue(res), 'login sets a session cookie');
});

test('incorrect password and unknown email produce the SAME generic message', async () => {
  await register({ ...REGISTER_BODY, email: 'enum@example.com' });

  const wrongPassword = await login('enum@example.com', 'WrongPass1!');
  const unknownEmail = await login('nobody@example.com', 'Whatever1!');

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.body.error.code, 'UNAUTHORIZED');
  assert.equal(wrongPassword.body.error.message, unknownEmail.body.error.message);
});

test('an invalid login body is a 422, not a bounced password check', async () => {
  for (const body of [{ email: 'x@y.com' }, { password: 'a' }, {}]) {
    const res = await request(app).post('/api/v1/auth/login').send(body);
    assert.equal(res.status, 422);
  }
});

test('a suspended account cannot log in and gets a specific message', async () => {
  await register({ ...REGISTER_BODY, email: 'suspended@example.com' });
  await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE email = $1`, [
    'suspended@example.com',
  ]);

  const res = await login('suspended@example.com');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.match(res.body.error.message, /suspended/i);
});

/* -------------------------------------------------------------------------- */
/* Session & /me                                                               */
/* -------------------------------------------------------------------------- */

test('GET /me returns the authenticated user', async () => {
  const { cookie } = await createAccount({ email: 'me@example.com' });

  const res = await request(app).get('/api/v1/auth/me').set(cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.email, 'me@example.com');
  assert.equal(res.body.data.user.password_hash, undefined);
});

test('GET /me without a cookie is 401', async () => {
  const res = await request(app).get('/api/v1/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('GET /me with a forged cookie is 401', async () => {
  const res = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', `${COOKIE}=forged-token-value`);
  assert.equal(res.status, 401);
});

test('GET /me with an expired session is 401', async () => {
  const { cookie } = await createAccount({ email: 'expired@example.com' });
  await db.query(`UPDATE user_sessions SET expires_at = NOW() - interval '1 hour'`);

  const res = await request(app).get('/api/v1/auth/me').set(cookie);
  assert.equal(res.status, 401);
});

test('logout revokes the session and the cookie stops working', async () => {
  const { cookie } = await createAccount({ email: 'logout@example.com' });

  const logoutRes = await request(app).post('/api/v1/auth/logout').set(cookie);
  assert.equal(logoutRes.status, 204);

  const cleared = sessionValue(logoutRes);
  assert.ok(cleared, 'logout expires the cookie');
  assert.match(cleared.raw, /Max-Age=0/);

  const after = await request(app).get('/api/v1/auth/me').set(cookie);
  assert.equal(after.status, 401, 'the logged-out cookie no longer authenticates');
});

test('logout without a session is still a clean 204', async () => {
  const res = await request(app).post('/api/v1/auth/logout');
  assert.equal(res.status, 204);
});

test('a suspended user with a still-live session is rejected', async () => {
  const { cookie } = await createAccount({ email: 'livesession@example.com' });
  await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE email = $1`, [
    'livesession@example.com',
  ]);

  const res = await request(app).get('/api/v1/auth/me').set(cookie);
  assert.equal(res.status, 403);
});

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

test('profile can be updated via PATCH and the result reflects the change', async () => {
  const { cookie } = await createAccount({ email: 'profile@example.com' });

  const res = await request(app)
    .patch('/api/v1/auth/profile')
    .set(cookie)
    .send({ name: 'Tigist Newname', phone: '0922223333' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.name, 'Tigist Newname');
  assert.equal(res.body.data.user.phone, '0922223333');
  assert.equal(res.body.data.user.email, 'profile@example.com');
});

test('profile updates can never change role, status or email', async () => {
  const { cookie } = await createAccount({ email: 'tamper@example.com' });

  const res = await request(app)
    .patch('/api/v1/auth/profile')
    .set(cookie)
    .send({ name: 'Tamper Test', role: 'ADMIN', status: 'INACTIVE', email: 'evil@example.com' });

  assert.equal(res.status, 200);
  const user = res.body.data.user;
  assert.equal(user.name, 'Tamper Test', 'the legitimate field is applied');
  assert.equal(user.role, 'CUSTOMER');
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.email, 'tamper@example.com');
});

test('profile validation: invalid phone refused, empty body refused', async () => {
  const { cookie } = await createAccount({ email: 'profilevalid@example.com' });

  const badPhone = await request(app)
    .patch('/api/v1/auth/profile')
    .set(cookie)
    .send({ phone: 'not-a-phone' });
  assert.equal(badPhone.status, 422);

  const empty = await request(app).patch('/api/v1/auth/profile').set(cookie).send({});
  assert.equal(empty.status, 422);
});

test('profile endpoints are protected: no session means 401', async () => {
  const res = await request(app).patch('/api/v1/auth/profile').send({ name: 'X' });
  assert.equal(res.status, 401);
});

/* -------------------------------------------------------------------------- */
/* Password change                                                             */
/* -------------------------------------------------------------------------- */

test('changing the password rejects a wrong current password', async () => {
  const { cookie } = await createAccount({ email: 'pw@example.com' });

  const res = await request(app)
    .post('/api/v1/auth/password')
    .set(cookie)
    .send({ currentPassword: 'wrong', newPassword: 'NewPass2!', newPasswordConfirmation: 'NewPass2!' });

  assert.equal(res.status, 400);
});

test('changing the password invalidates the old password and keeps the session', async () => {
  const { cookie } = await createAccount({ email: 'pw2@example.com' });

  const change = await request(app)
    .post('/api/v1/auth/password')
    .set(cookie)
    .send({ currentPassword: REGISTER_BODY.password, newPassword: 'NewPass2!', newPasswordConfirmation: 'NewPass2!' });
  assert.equal(change.status, 200);

  const oldLogin = await login('pw2@example.com', REGISTER_BODY.password);
  assert.equal(oldLogin.status, 401, 'the old password must stop working');

  const newLogin = await login('pw2@example.com', 'NewPass2!');
  assert.equal(newLogin.status, 200);

  const me = await request(app).get('/api/v1/auth/me').set(cookie);
  assert.equal(me.status, 200, 'the current session survives a password change');
});

test('changing the password revokes every OTHER session', async () => {
  const { cookie } = await createAccount({ email: 'pw3@example.com' });
  const second = await login('pw3@example.com');
  const secondCookie = withSession(second);

  await request(app)
    .post('/api/v1/auth/password')
    .set(cookie)
    .send({ currentPassword: REGISTER_BODY.password, newPassword: 'NewPass2!', newPasswordConfirmation: 'NewPass2!' });

  const otherSession = await request(app).get('/api/v1/auth/me').set(secondCookie);
  assert.equal(otherSession.status, 401, 'the second device session must be revoked');
});

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

const ADDRESS = {
  label: 'Home',
  full_name: 'Tigist Alemu',
  phone: '0911556677',
  city: 'Addis Ababa',
  area: 'Bole',
  street: 'Bole Road',
  landmark: 'Edna Mall',
  additional_notes: 'Call on arrival',
};

async function addAddress(cookie, overrides = {}) {
  return request(app).post('/api/v1/auth/addresses').set(cookie).send({ ...ADDRESS, ...overrides });
}

test('addresses are protected', async () => {
  const res = await request(app).get('/api/v1/auth/addresses');
  assert.equal(res.status, 401);
});

test('the first address becomes the default; later ones do not', async () => {
  const { cookie } = await createAccount({ email: 'addr0@example.com' });

  const first = await addAddress(cookie, { label: 'Work' });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.address.is_default, true);

  const second = await addAddress(cookie, { label: 'Office' });
  assert.equal(second.status, 201);
  assert.equal(second.body.data.address.is_default, false);

  const list = await request(app).get('/api/v1/auth/addresses').set(cookie);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.addresses.length, 2);
});

test('address validation rejects bad phones and requires street/city/area', async () => {
  const { cookie } = await createAccount({ email: 'addrvalid@example.com' });

  const badPhone = await addAddress(cookie, { phone: '12' });
  assert.equal(badPhone.status, 422);

  const missing = await addAddress(cookie, { street: ' ' });
  assert.equal(missing.status, 422);
});

test('an address can be edited', async () => {
  const { cookie } = await createAccount({ email: 'addredit@example.com' });
  const created = await addAddress(cookie);

  const res = await request(app)
    .patch(`/api/v1/auth/addresses/${created.body.data.address.id}`)
    .set(cookie)
    .send({ label: 'Flat 3B', area: 'Kirkos' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.address.label, 'Flat 3B');
  assert.equal(res.body.data.address.area, 'Kirkos');
  assert.equal(res.body.data.address.full_name, ADDRESS.full_name, 'untouched fields survive');
});

test('an empty address update is a 422', async () => {
  const { cookie } = await createAccount({ email: 'addrempty@example.com' });
  const created = await addAddress(cookie);

  const res = await request(app)
    .patch(`/api/v1/auth/addresses/${created.body.data.address.id}`)
    .set(cookie)
    .send({});
  assert.equal(res.status, 422);
});

test('set-default atomically keeps exactly one default address', async () => {
  const { cookie } = await createAccount({ email: 'addrdef@example.com' });
  const one = (await addAddress(cookie, { label: 'One' })).body.data.address;
  const two = (await addAddress(cookie, { label: 'Two' })).body.data.address;

  const promote = await request(app)
    .post(`/api/v1/auth/addresses/${two.id}/default`)
    .set(cookie);
  assert.equal(promote.status, 200);
  assert.equal(promote.body.data.address.is_default, true);

  const { rows } = await db.query(
    `SELECT id FROM addresses WHERE is_default AND user_id = (SELECT id FROM users WHERE email = $1)`,
    ['addrdef@example.com']
  );
  assert.equal(rows.length, 1, 'only one default per user');
  assert.equal(rows[0].id, two.id);
});

test('deleting the default address promotes the oldest remaining one', async () => {
  const { cookie } = await createAccount({ email: 'addrdel@example.com' });
  const one = (await addAddress(cookie, { label: 'One' })).body.data.address;
  const two = (await addAddress(cookie, { label: 'Two' })).body.data.address;

  const removed = await request(app)
    .delete(`/api/v1/auth/addresses/${one.id}`)
    .set(cookie);
  assert.equal(removed.status, 200, 'address was deletable');
  assert.equal(removed.body.data.address.is_default, true, 'the deleted row was the default');

  const { rows } = await db.query(
    `SELECT id FROM addresses WHERE is_default AND user_id = (SELECT id FROM users WHERE email = $1)`,
    ['addrdel@example.com']
  );
  assert.deepEqual(rows.map((row) => row.id), [two.id], 'the remaining address was promoted');
});

test('address operations on another user / unknown id are 404', async () => {
  const { cookie } = await createAccount({ email: 'addrnf@example.com' });
  const ghost = '00000000-0000-4000-8000-000000000000';

  const res = await request(app)
    .delete(`/api/v1/auth/addresses/${ghost}`)
    .set(cookie);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

/* -------------------------------------------------------------------------- */
/* Security: CSRF & rate limiting                                              */
/* -------------------------------------------------------------------------- */

test('a cross-origin mutation is rejected with 403', async () => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'https://evil.example')
    .send({ email: 'x@y.com', password: 'whatever' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('an allowed frontend origin passes the CSRF check', async () => {
  const origin = env.frontendOrigins[0];
  const res = await request(app)
    .post('/api/v1/auth/register')
    .set('Origin', origin)
    .send({ ...REGISTER_BODY, email: 'csrf@example.com' });

  assert.equal(res.status, 201, `a registered origin (${origin}) must be accepted`);
});

test('failures return the standard envelope, not HTML or a stack trace', async () => {
  const res = await login('nobody@example.com', 'Wrong1!');
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(typeof res.body.error.message, 'string');
  assert.equal(res.body.error.details, undefined);
});

test('the credential endpoints respect a per-IP rate limit', async () => {
  const limited = express();
  limited.use(createAuthLimiter({ windowMs: 60_000, limit: 2 }));
  limited.post('/login', (req, res) => res.json({ ok: true }));

  const first = await request(limited).post('/login');
  const second = await request(limited).post('/login');
  const third = await request(limited).post('/login');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'RATE_LIMITED');
});