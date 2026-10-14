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

/* -------------------------------------------------------------------------- */
/* Content Security Policy                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Collects the unique `scheme://host` origins from a list of URL-ish strings.
 *
 * Used to build `connect-src`. Values that are not absolute http(s) URLs (a
 * relative path, an empty string, a malformed value) are skipped rather than
 * throwing: a missing or bad configuration must not stop the server booting.
 *
 * @param {Array<string|undefined|null>} values
 * @returns {string[]}
 */
function collectOrigins(values) {
  const origins = new Set();
  for (const value of values) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch {
      // Relative or malformed value: nothing to allow.
    }
  }
  return [...origins];
}

/** Builds the `connect-src` list: `'self'` plus any configured API origin. */
function httpOriginsForCsp() {
  return [...new Set(["'self'", ...collectOrigins([env.API_BASE_URL, ...env.frontendOrigins])])];
}

/**
 * The Content-Security-Policy enforced in production.
 *
 * Why these values, and not a stricter set:
 *
 *   img-src https:  Product images are admin-entered absolute URLs and the seed
 *                   data uses an external placeholder host. `'self' data:` alone
 *                   would render every product image broken.
 *   style-src       `'unsafe-inline'` is required: components set per-element
 *                   `style` attributes (swatch colours, progress widths,
 *                   skeleton sizes) at runtime, which CSP treats as inline
 *                   styles. The Google Fonts stylesheet needs its host allowed.
 *   connect-src     `'self'` covers the common case (this server also serving
 *                   the static frontend). Any other API origin is derived from
 *                   configuration rather than hard-coded.
 *   script-src      `'self'` only. There is no inline `<script>` and no inline
 *                   event handler anywhere in the frontend, so `script-src-attr
 *                   'none'` is enforceable without weakening script-src.
 *
 * Exported so tests can assert the policy without running in production mode.
 */
export const CSP_DIRECTIVES = Object.freeze({
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'data:', 'https:'],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: Object.freeze(httpOriginsForCsp()),
  manifestSrc: ["'self'"],
  workerSrc: ["'self'"],
  upgradeInsecureRequests: [],
});

/** Helmet options, exported so a test can mount the production policy directly. */
export const helmetOptions = Object.freeze({
  // CSP is only asserted in production: the dev server runs over plain HTTP on
  // localhost and the test client does not execute the frontend, so enabling it
  // there would only produce noise. Production gets the explicit policy above.
  contentSecurityPolicy: env.isProduction ? { directives: CSP_DIRECTIVES } : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
});

/** Secure HTTP headers. */
export const helmetMiddleware = helmet(helmetOptions);

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                                */
/* -------------------------------------------------------------------------- */

/** The standard `{ success:false, error }` envelope shared by every limiter. */
function limitMessage(message) {
  return {
    success: false,
    error: { code: ERROR_CODES.RATE_LIMITED, message },
  };
}

/**
 * Builds a limiter for one class of traffic.
 * A factory rather than a singleton so tests can mount one with a small window
 * and actually observe the 429 without exhausting the shared instance.
 * @param {{ windowMs?: number, limit?: number, message: string }} options
 */
function createLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: limitMessage(message),
  });
}

/** Standard API rate limiter (e.g. 300 requests / 15 min per IP). */
export const apiLimiter = createLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  message: 'Too many requests. Please try again later.',
});

/** @param {{ windowMs?: number, limit?: number }} [overrides] */
export function createAuthLimiter({
  windowMs = env.RATE_LIMIT_WINDOW_MS,
  limit = env.AUTH_RATE_LIMIT_MAX,
} = {}) {
  return createLimiter({
    windowMs,
    limit,
    message: 'Too many attempts. Please try again later.',
  });
}

/** Stricter limiter reserved for the credential endpoints (login/register). */
export const authLimiter = createAuthLimiter();

/**
 * Limiter for authenticated writes that are cheap to spam: submitting a review,
 * changing a password. Less strict than the credential limiter (a legitimate
 * shopper may write several reviews) but far below the general API ceiling.
 * @param {{ windowMs?: number, limit?: number }} [overrides]
 */
export function createWriteLimiter({
  windowMs = env.RATE_LIMIT_WINDOW_MS,
  limit = env.WRITE_RATE_LIMIT_MAX,
} = {}) {
  return createLimiter({
    windowMs,
    limit,
    message: 'Too many requests. Please slow down and try again shortly.',
  });
}

/** Shared limiter for authenticated write endpoints. */
export const writeLimiter = createWriteLimiter();

/**
 * Limiter for type-ahead search, which can fire once per keystroke. Deliberately
 * generous so normal shopping is never interrupted, but bounded so the search
 * endpoint cannot be used as a free query amplifier.
 * @param {{ windowMs?: number, limit?: number }} [overrides]
 */
export function createSearchLimiter({
  windowMs = env.RATE_LIMIT_WINDOW_MS,
  limit = env.SEARCH_RATE_LIMIT_MAX,
} = {}) {
  return createLimiter({
    windowMs,
    limit,
    message: 'Too many searches. Please wait a moment and try again.',
  });
}

/** Shared limiter for the search endpoints. */
export const searchLimiter = createSearchLimiter();

export default {
  corsOptions,
  helmetMiddleware,
  helmetOptions,
  CSP_DIRECTIVES,
  apiLimiter,
  authLimiter,
  createAuthLimiter,
  writeLimiter,
  createWriteLimiter,
  searchLimiter,
  createSearchLimiter,
};
