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

    // --- Authentication (consumed once auth is implemented) ------------
    JWT_SECRET: z.string().default(''),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().default(''),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

    // --- Rate limiting ------------------------------------------------
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

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
  /** Frontend origins allowed by CORS, parsed from FRONTEND_URL. */
  frontendOrigins: values.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
});

export default env;
