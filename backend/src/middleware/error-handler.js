import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import env from '../config/env.js';

/**
 * Centralized error handler.
 *
 * Order of responsibilities:
 * 1. Handle AppError: log at info/warn and return a consistent envelope
 * 2. Handle known Postgres errors (e.g. unique_violation) gracefully
 * 3. Handle other errors: log with stack trace and return 500 (generic message)
 * 4. Never expose internal details or stack traces in production
 */
/**
 * Maps a known PostgreSQL error to an `AppError`, or returns `null` if the
 * error is not one of the recognised codes.
 *
 * @param {Error & { code?: string, table?: string }} err
 * @param {{ isProduction?: boolean }} [options] defaults to the running
 *   environment; overridable so the production message can be asserted from a
 *   test (which always runs with `NODE_ENV=test`).
 * @returns {AppError|null}
 */
export function mapPostgresError(err, { isProduction = env.isProduction } = {}) {
  // pg unique_violation
  if (err.code === '23505') {
    // The raw `err.table` names an internal table. Leaking it hands an attacker
    // a free schema map, so production always returns a generic message while
    // development keeps the specific one for debugging.
    const message = isProduction
      ? 'A record with these details already exists'
      : `${err.table ?? 'record'} already exists`;
    return new AppError(message, 409, ERROR_CODES.CONFLICT);
  }
  // foreign_key_violation
  if (err.code === '23503') {
    return new AppError('Referenced resource does not exist', 409, ERROR_CODES.CONFLICT);
  }
  // check_violation / not_null_violation
  if (err.code === '23502' || err.code === '23514') {
    return new AppError('Invalid data provided', 422, ERROR_CODES.UNPROCESSABLE_ENTITY);
  }
  // invalid_text_representation
  if (err.code === '22P02') {
    return new AppError('Invalid input format', 400, ERROR_CODES.BAD_REQUEST);
  }
  return null;
}

/** Builds the `{ success, error }` envelope described in the requirements. */
function buildErrorEnvelope(error) {
  return {
    success: false,
    error: {
      code: error.code ?? ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: error.message ?? 'Internal server error',
      ...(error.details !== undefined && !env.isProduction ? { details: error.details } : {}),
    },
  };
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let handled = err;

  if (!(handled instanceof AppError)) {
    const pgMapped = mapPostgresError(handled);
    if (pgMapped) {
      handled = pgMapped;
    } else {
      // Unexpected error: log as error with stack trace.
      logger.error('Unhandled error', {
        method: req.method,
        url: req.originalUrl,
        stack: handled.stack,
        message: handled.message,
      });

      // Return a generic, non-sensitive message in production.
      const message = env.isProduction ? 'Internal server error' : handled.message;
      handled = new AppError(
        message,
        500,
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        env.isProduction ? undefined : { stack: handled.stack }
      );
    }
  }

  if (handled.statusCode >= 500) {
    logger.error('Server error', {
      statusCode: handled.statusCode,
      code: handled.code,
      method: req.method,
      url: req.originalUrl,
      message: handled.message,
    });
  } else {
    logger.info('Client error', {
      statusCode: handled.statusCode,
      code: handled.code,
      method: req.method,
      url: req.originalUrl,
      message: handled.message,
    });
  }

  res.status(handled.statusCode).json(buildErrorEnvelope(handled));
}

export default errorHandler;
