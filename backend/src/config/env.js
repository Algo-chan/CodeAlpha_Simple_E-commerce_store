import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the `backend/` folder. */
export const paths = {
  backendRoot: path.resolve(currentDir, '..', '..'),
  repoRoot: path.resolve(currentDir, '..', '..', '..'),
};

// Environment files are loaded from the most specific location to the least specific.
// `dotenv` never overwrites a variable that is already defined, so `backend/.env`
// wins over the repository-root `.env`.
dotenv.config({ path: path.join(paths.backendRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(paths.repoRoot, '.env'), quiet: true });

/**
 * Accepts booleans written as `true/false`, `1/0`, `yes/no`.
 * `z.coerce.boolean()` cannot be used because it treats every non-empty
 * string as `true` (so `"false"` would become `true`).
 */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean'
      ? value
      : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    // --- Database ------------------------------------------------------
    DATABASE_URL: z.string().default(''),
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_USER: z.string().default('postgres'),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().default('ecommerce_store'),
    DB_SSL: booleanFromEnv.default('false'),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnv.default('false'),

    // --- HTTP / CORS --------------------------------------------------
    FRONTEND_URL: z.string().default('http://localhost:5500'),
    /**
     * The deployment's own public origin, when it is known before the app
     * boots. `PUBLIC_ORIGIN` is the generic spelling; `RENDER_EXTERNAL_URL` is
     * injected by Render automatically. Both are same-origin by definition, so
     * trusting them adds no new trust — but they MUST be included, because a
     * browser sends an `Origin` header even on a same-origin write and the CORS
     * middleware would otherwise reject it.
     */
    PUBLIC_ORIGIN: z.string().default(''),
    RENDER_EXTERNAL_URL: z.string().default(''),

    // --- Authentication (consumed once auth is implemented) ------------
    JWT_SECRET: z.string().default(''),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().default(''),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

    // --- Session cookie ---------------------------------------------------
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .default(168),

    // --- Rate limiting ------------------------------------------------
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    /** Reviews, password changes and other authenticated writes. */
    WRITE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
    /** Type-ahead search, which can fire per keystroke. Generous but bounded. */
    SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),

    // --- Online payments ----------------------------------------------
    /**
     * Which online gateway is active. `NONE` disables online payment entirely
     * (checkout stays COD-only) without a code change. `MOCK` is the sandbox
     * provider that stands in for a real gateway until credentials exist.
     */
    PAYMENT_PROVIDER: z.enum(['NONE', 'MOCK', 'TELEBIRR', 'STRIPE', 'PAYSTACK']).default('MOCK'),
    /**
     * HMAC secret a provider uses to sign its webhooks. Never written to logs,
     * never returned to a client, and required in production when a provider is
     * active. The sandbox falls back to a well-known development secret so a
     * fresh checkout works before secrets are provisioned.
     */
    PAYMENT_WEBHOOK_SECRET: z.string().default(''),
    /** Reject a signed notification whose timestamp is older than this. */
    PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
    /** Where the sandbox provider sends a shopper to approve a payment. */
    PAYMENT_MOCK_CHECKOUT_URL: z
      .string()
      .default('http://localhost:4000/api/v1/payments/mock/checkout'),
    /** Minutes a PENDING online payment may age before it is expired. */
    PAYMENT_PENDING_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(10_080).default(30),

    // --- Logging ------------------------------------------------------
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

    // --- Frontend build (optional) -------------------------------------
    API_BASE_URL: z.string().default('http://localhost:4000/api/v1'),
  })
  .superRefine((values, ctx) => {
    // Fail fast in production: a weak or missing secret must never ship.
    if (values.NODE_ENV === 'production') {
      if (values.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET must be set to at least 32 characters in production',
        });
      }
      if (values.JWT_SECRET === values.JWT_REFRESH_SECRET && values.JWT_REFRESH_SECRET !== '') {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must differ from JWT_SECRET',
        });
      }
      // A live online provider with no signing secret would accept unsigned
      // notifications. Fail fast rather than ship a forgeable webhook.
      if (values.PAYMENT_PROVIDER !== 'NONE' && values.PAYMENT_WEBHOOK_SECRET.length < 16) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_WEBHOOK_SECRET'],
          message:
            'PAYMENT_WEBHOOK_SECRET must be set to at least 16 characters when PAYMENT_PROVIDER is not NONE',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the missing values.`
  );
}

const values = parsed.data;

/** Validated, immutable application configuration. */
export const env = Object.freeze({
  ...values,
  nodeEnv: values.NODE_ENV,
  isProduction: values.NODE_ENV === 'production',
  isDevelopment: values.NODE_ENV === 'development',
  isTest: values.NODE_ENV === 'test',
  /**
   * Origins allowed by CORS: the configured `FRONTEND_URL` list plus the
   * deployment's own public origin (`PUBLIC_ORIGIN` / Render's injected
   * `RENDER_EXTERNAL_URL`). Deduplicated, because the two often coincide.
   */
  frontendOrigins: [
    ...new Set(
      [values.FRONTEND_URL, values.PUBLIC_ORIGIN, values.RENDER_EXTERNAL_URL]
        .flatMap((value) => value.split(','))
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
  ],
});

export default env;
