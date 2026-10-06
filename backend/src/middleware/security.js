import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import env from '../config/env.js';
import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

/**
 * CORS configuration.
 * Only the configured frontend origin(s) are allowed. Credentials are enabled
 * because the future cookie-based auth will require it.
 */
export const corsOptions = {
  origin(origin, callback) {
    // Allow same-origin/tooling requests (curl, server-side, Postman without origin).
    if (!origin) return callback(null, true);

    if (env.frontendOrigins.includes(origin)) return callback(null, true);

    return callback(
      new AppError(`Origin not allowed by CORS: ${origin}`, 403, ERROR_CODES.FORBIDDEN)
    );
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

/** Secure HTTP headers. */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: env.isProduction ? undefined : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/** Standard API rate limiter (e.g. 300 requests / 15 min per IP). */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests. Please try again later.',
    },
  },
});

/**
 * Builds the stricter limiter reserved for the credential endpoints.
 * A factory rather than a singleton so tests can mount one with a small window
 * and actually observe the 429 without exhausting the shared instance.
 * @param {{ windowMs?: number, limit?: number }} [overrides]
 */
export function createAuthLimiter({
  windowMs = env.RATE_LIMIT_WINDOW_MS,
  limit = env.AUTH_RATE_LIMIT_MAX,
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many attempts. Please try again later.',
      },
    },
  });
}

/** Stricter limiter reserved for auth routes once they exist. */
export const authLimiter = createAuthLimiter();

export default { corsOptions, helmetMiddleware, apiLimiter, authLimiter, createAuthLimiter };
