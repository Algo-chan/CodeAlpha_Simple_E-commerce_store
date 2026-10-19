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
import { noStore } from './middleware/cache.js';
import { getHealthReport } from './services/health.service.js';
import { sendSuccess } from './utils/http-response.js';
import { logger } from './utils/logger.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express application.
 *
 * Exported separately from `server.js` so tests can mount it with supertest
 * without opening a real port.
 *
 * @param {{ db?: object }} [options]
 * @param {object} [options.db] a database executor to attach as `req.db`.
 *   Production omits it, and the repositories fall back to the `pg` pool. Tests
 *   pass a PGlite instance so the whole HTTP stack can be exercised with no
 *   PostgreSQL server running — including validation, controllers, routing and
 *   the error envelope, none of which a service-level test would cover.
 */
export function createApp({ db } = {}) {
  const app = express();

  // Behind a proxy (nginx / a hosting platform) so `req.ip` and rate limiting
  // see the real client IP.
  app.set('trust proxy', 1);

  // Attached before any route so every controller and service can reach the
  // executor through the request rather than importing a pool directly. That
  // indirection is what makes the catalogue layer testable at all.
  if (db) {
    app.use((req, _res, next) => {
      req.db = db;
      next();
    });
  }

  // --- Global security & parsing middleware ---------------------------
  app.use(helmetMiddleware);
  app.use(cors(corsOptions));
  app.use(compression());
  app.use(
    express.json({
      limit: '100kb',
      // Keep the exact bytes a provider signed. Payment webhooks are verified
      // against the raw buffer, never a re-serialised copy of the parsed body:
      // JSON whitespace and key order are not stable across a round-trip.
      verify: (req, _res, buf) => {
        if (buf?.length) req.rawBody = buf;
      },
    })
  );
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
  // `noStore` runs first so that, unless a route opts into public caching, the
  // response is not stored by a browser or an intermediary.
  app.use(API_BASE_PATH, noStore, ...(env.isTest ? [] : [apiLimiter]), routes);

  // Health probe for the platform load balancer / orchestrator.
  //
  // Deliberately mounted OUTSIDE `/api/v1` and *before* the API rate limiter, so
  // a monitor polling every few seconds cannot exhaust the public request budget
  // or be throttled itself. It reports only non-sensitive state: liveness,
  // uptime and whether the database answers. It never echoes configuration,
  // connection strings, versions or stack traces.
  //
  // 200 = ready to serve (database reachable). 503 = the process is up but
  // cannot serve correctly, which is what a load balancer should drain on.
  app.get('/health', async (req, res) => {
    const report = await getHealthReport(env.nodeEnv);
    const healthy = report.database === 'connected';

    res.set('Cache-Control', 'no-store');
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database: report.database,
      uptime: Math.round(process.uptime()),
    });
  });

  // Minimal landing response so `GET /` is not a confusing 404.
  //
  // Development and test only: in production the static storefront is mounted at
  // `/` and serves `index.html` there, so this JSON would otherwise shadow the
  // homepage. The API's own description stays reachable at `GET /api/v1`.
  if (!env.isProduction) {
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
  }

  // Static hosting of the frontend (production convenience) so the storefront
  // and the API share one origin — which is what keeps the session cookie
  // `SameSite=Lax` and the CSP `connect-src 'self'`.
  //
  // `extensions: ['html']` makes `/admin` resolve to `admin.html`, matching the
  // dev server. The cache policy is deliberately split: HTML is `no-cache`
  // (revalidate every time) so a deploy is visible on the next navigation;
  // everything else gets a short public lifetime. Filenames are not
  // content-hashed, so the window is deliberately short — a long `immutable`
  // max-age would keep serving the old bundle after a deploy. ETag/Last-Modified
  // still make a revalidation cheap (304) once the hour has passed.
  const frontendDist = path.join(paths.repoRoot, 'frontend');
  if (env.isProduction) {
    app.use(
      express.static(frontendDist, {
        extensions: ['html'],
        index: 'index.html',
        etag: true,
        lastModified: true,
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      })
    );
    logger.info('Serving static frontend from', frontendDist);
  }

  // --- Error handling (must be registered last) ----------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { currentDir as appDir };
export default createApp;
