/**
 * Test bootstrap. Must be imported FIRST in every test file so that
 * `NODE_ENV=test` is set before the config modules are evaluated.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

// Keep tests fast when PostgreSQL is not running locally.
process.env.DB_CONNECTION_TIMEOUT_MS = process.env.DB_CONNECTION_TIMEOUT_MS ?? '1500';
