/**
 * Security regression tests (Phase 11 hardening).
 *
 * These pin down the controls that are easy to weaken by accident: the response
 * headers, the Content-Security-Policy, the CORS gate, the cookie attributes,
 * the production error message, and the rate limiters. They run against the
 * running app where a request is the thing under test, and against the exported
 * policy objects where the behaviour only exists in production (CSP is disabled
 * under test, so the policy is mounted directly instead of read off the app).
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import helmet from 'helmet';
import { createApp } from '../src/app.js';
import {
  CSP_DIRECTIVES,
  helmetOptions,
  createWriteLimiter,
  createSearchLimiter,
} from '../src/middleware/security.js';
import { mapPostgresError } from '../src/middleware/error-handler.js';
import { serializeCookie } from '../src/utils/cookies.js';
import { closePool } from '../src/config/db.js';
import env from '../src/config/env.js';

const app = createApp();

test.after(async () => {
  await closePool();
});

/** Splits a serialised CSP header into `{ directive: [values] }`. */
function parseCsp(header) {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [directive, ...values] = part.split(/\s+/);
        return [directive, values];
      })
  );
}

/* -------------------------------------------------------------------------- */
/* Headers & CSP                                                                */
/* -------------------------------------------------------------------------- */

test('the production CSP is applied and is not trivially permissive', async () => {
  const policyApp = express();
  policyApp.use(helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }));
  policyApp.get('/', (req, res) => res.json({ ok: true }));

  const res = await request(policyApp).get('/');
  const csp = parseCsp(res.headers['content-security-policy']);

  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['script-src'], ["'self'"], 'scripts are same-origin only');
  assert.deepEqual(csp['script-src-attr'], ["'none'"], 'no inline event handlers');
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);

  assert.ok(!csp['script-src'].includes("'unsafe-inline'"), 'script-src must not allow inline');
  assert.ok(csp['img-src'].includes('https:'), 'external product images must load');
  assert.ok(csp['connect-src'].includes("'self'"), 'same-origin API calls must be allowed');
});

test('CSP_DIRECTIVES allow exactly the font hosts the storefront uses', () => {
  assert.ok(CSP_DIRECTIVES.styleSrc.includes('https://fonts.googleapis.com'));
  assert.ok(CSP_DIRECTIVES.fontSrc.includes('https:'));
  assert.ok(CSP_DIRECTIVES.connectSrc.includes("'self'"));
});

test('the production helmet policy sets the standard hardening headers', async () => {
  const policyApp = express();
  policyApp.use(helmet(helmetOptions));
  policyApp.get('/', (req, res) => res.json({ ok: true }));

  const res = await request(policyApp).get('/');

  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(res.headers['strict-transport-security'], /max-age=\d+/);
});

test('the running app always sends the baseline headers', async () => {
  const res = await request(app).get('/api/v1/health');

  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
});

test('CSP is intentionally disabled outside production', () => {
  // The test/dev server runs over plain HTTP; enabling CSP there would only add
  // noise. This documents the deliberate difference rather than an omission.
  assert.equal(env.isProduction, false);
  assert.equal(helmetOptions.contentSecurityPolicy, false);
});

/* -------------------------------------------------------------------------- */
/* CORS                                                                         */
/* -------------------------------------------------------------------------- */

test('a cross-origin request from an unknown origin is refused', async () => {
  const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');

  assert.equal(res.status, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('a request from a configured frontend origin is allowed', async () => {
  const origin = env.frontendOrigins[0];
  const res = await request(app).get('/api/v1/health').set('Origin', origin);

  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], origin);
});

/* -------------------------------------------------------------------------- */
/* Cookie attributes                                                            */
/* -------------------------------------------------------------------------- */

test('session cookies are HttpOnly and SameSite=Lax', () => {
  const cookie = serializeCookie('ecom_session', 'token-value', { maxAgeSeconds: 60 });

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /^ecom_session=token-value; Path=\//);
});

test('the Secure attribute is present when the deployment is HTTPS', () => {
  const insecure = serializeCookie('ecom_session', 'v');
  const secure = serializeCookie('ecom_session', 'v', { isSecure: true });

  assert.ok(!/;\s*Secure\b/.test(insecure), 'omitted over plain HTTP');
  assert.match(secure, /;\s*Secure/);
});

/* -------------------------------------------------------------------------- */
/* Production error messages                                                    */
/* -------------------------------------------------------------------------- */

test('a unique-violation never leaks the table name in production', () => {
  const pgError = Object.assign(new Error('duplicate key'), {
    code: '23505',
    table: 'users',
  });

  const production = mapPostgresError(pgError, { isProduction: true });
  assert.equal(production.statusCode, 409);
  assert.doesNotMatch(production.message, /users/);
  assert.equal(production.message, 'A record with these details already exists');

  // Development keeps the specific message so a bug is debuggable.
  const development = mapPostgresError(pgError, { isProduction: false });
  assert.match(development.message, /users/);
});

test('non-Postgres errors are not mapped', () => {
  assert.equal(mapPostgresError(new Error('boom')), null);
});

/* -------------------------------------------------------------------------- */
/* Rate limiters                                                                */
/* -------------------------------------------------------------------------- */

/** Asserts that a limiter returns 429 once its budget is spent. */
async function assertLimiterThrottles(limiter) {
  const limited = express();
  limited.use(limiter);
  limited.get('/', (req, res) => res.json({ ok: true }));

  const first = await request(limited).get('/');
  const second = await request(limited).get('/');
  const third = await request(limited).get('/');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'RATE_LIMITED');
}

test('the authenticated-write limiter stops a spam of writes', async () => {
  await assertLimiterThrottles(createWriteLimiter({ windowMs: 60_000, limit: 2 }));
});

test('the search limiter stops a spam of searches', async () => {
  await assertLimiterThrottles(createSearchLimiter({ windowMs: 60_000, limit: 2 }));
});

/* -------------------------------------------------------------------------- */
/* Envelope discipline                                                          */
/* -------------------------------------------------------------------------- */

test('an unknown route answers with the JSON envelope, not HTML', async () => {
  const res = await request(app).get('/api/v1/does-not-exist');

  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.equal(typeof res.body.error.message, 'string');
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
});
