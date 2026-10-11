/**
 * Test bootstrap. Must be imported FIRST in every test file so that
 * `NODE_ENV=test` is set before the config modules are evaluated.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

// Keep tests fast when PostgreSQL is not running locally.
process.env.DB_CONNECTION_TIMEOUT_MS = process.env.DB_CONNECTION_TIMEOUT_MS ?? '1500';

// A deterministic online payment sandbox: the mock provider signs webhooks with
// the secret below, which the payments tests read back from env.
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? 'MOCK';
process.env.PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'test-webhook-secret';
process.env.PAYMENT_PENDING_TIMEOUT_MINUTES = process.env.PAYMENT_PENDING_TIMEOUT_MINUTES ?? '30';
