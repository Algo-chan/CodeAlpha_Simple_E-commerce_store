import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';

import env, { paths } from './config/env.js';
import { API_BASE_PATH, API_VERSION } from './config/constants.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { corsOptions, helmetMiddleware, apiLimiter } from './middleware/security.js';
import { sendSuccess } from './utils/http-response.js';
import { logger } from './utils/logger.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express application.
 * Exported separately from `server.js` so tests can mount it with supertest
 * without opening a real port.
 */
export function createApp() {
  const app = express();

  // Behind a proxy (nginx / a hosting platform) so `req.ip` and rate limiting
  // see the real client IP.
  app.set('trust proxy', 1);

  // --- Global security & parsing middleware ---------------------------
  app.use(helmetMiddleware);
  app.use(cors(corsOptions));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  if (!env.isTest) {
    app.use(
      morgan(env.isProduction ? 'combined' : 'dev', {
        skip: (req) => req.originalUrl === `${API_BASE_PATH}/health`,
      })
    );
  }

  // --- API routes -----------------------------------------------------
  // Every route lives under the versioned base path and behind a rate limiter.
  app.use(API_BASE_PATH, ...(env.isTest ? [] : [apiLimiter]), routes);

  // Minimal landing response so `GET /` is not a confusing 404.
  app.get('/', (req, res) =>
    sendSuccess(res, {
      data: {
        name: 'E-commerce API',
        version: API_VERSION,
        docs: 'docs/api.md',
        health: `${API_BASE_PATH}/health`,
      },
    })
  );

  // Optional static hosting of the frontend build (production convenience).
  const frontendDist = path.join(paths.repoRoot, 'frontend');
  if (env.isProduction) {
    app.use(express.static(frontendDist));
    logger.info('Serving static frontend from', frontendDist);
  }

  // --- Error handling (must be registered last) ----------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { currentDir as appDir };
export default createApp;
