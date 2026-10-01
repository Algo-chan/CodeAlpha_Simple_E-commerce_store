/**
 * Backend entry point.
 * Responsibilities: verify configuration, verify database connectivity,
 * start listening, shut down gracefully.
 */
import env from './src/config/env.js';
import { createApp } from './src/app.js';
import { getHealthReport } from './src/services/health.service.js';
import { closePool } from './src/config/db.js';
import { logger } from './src/utils/logger.js';

const app = createApp();

const server = app.listen(env.PORT, async () => {
  logger.info(
    `API ready on http://localhost:${env.PORT}${env.isProduction ? '' : ` (${env.NODE_ENV})`}`
  );

  const report = await getHealthReport(env.nodeEnv);
  if (report.database === 'connected') {
    logger.info('Database connected', { latencyMs: `${report.latencyMs}ms` });
  } else {
    logger.warn(
      `Database not reachable (${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}). ` +
        'The API will still start; check .env and run `npm run db:create && npm run migrate`.'
    );
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${env.PORT} is already in use. Change PORT in .env.`);
  } else {
    logger.error('Server failed to start', error);
  }
  process.exit(1);
});

/** Close HTTP server and database pool before exiting. */
async function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await closePool();
      logger.info('Database pool closed.');
    } catch (error) {
      logger.warn('Error while closing the database pool', { error: error.message });
    }
    process.exit(0);
  });

  // Force-exit if connections keep the server open.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exit(1);
});

export default server;
