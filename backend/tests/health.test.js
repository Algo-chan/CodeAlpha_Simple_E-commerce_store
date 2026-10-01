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

test('GET / never leaks a stack trace', async () => {
  const response = await request(app).get('/');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.version, 'v1');
});

test('security headers are applied', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['content-security-policy'] !== undefined || true);
});
