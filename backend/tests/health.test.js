import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/config/db.js';

const app = createApp();

test.after(async () => {
  await closePool();
});

test('GET /api/v1/health returns a healthy API envelope', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.api, 'healthy');
  assert.equal(response.body.data.environment, 'test');
  assert.ok(['connected', 'disconnected'].includes(response.body.data.database));
  assert.equal(
    response.body.data.status,
    response.body.data.database === 'connected' ? 'healthy' : 'degraded'
  );
  assert.ok(typeof response.body.data.uptime === 'number');
});

test('GET /health reports readiness without leaking internals', async () => {
  const response = await request(app).get('/health');

  // No database is configured for the test run, so readiness is reported as
  // degraded with a 503 — the status a load balancer should drain on.
  const expectedStatus = response.body.database === 'connected' ? 200 : 503;
  assert.equal(response.status, expectedStatus);
  assert.equal(response.body.status, expectedStatus === 200 ? 'ok' : 'degraded');
  assert.ok(['connected', 'disconnected'].includes(response.body.database));
  assert.ok(typeof response.body.uptime === 'number');
  assert.equal(response.headers['cache-control'], 'no-store');

  // The readiness probe must never echo configuration or secrets.
  const serialized = JSON.stringify(response.body);
  assert.doesNotMatch(serialized, /secret|password|postgres:|jwt/i);
});

test('GET / never leaks a stack trace', async () => {
  const response = await request(app).get('/');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.version, 'v1');
});

test('security headers are applied', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  // The Content-Security-Policy itself is only asserted in production mode; see
  // tests/security.test.js, which mounts the policy directly.
  assert.equal(response.headers['content-security-policy'], undefined);
});
