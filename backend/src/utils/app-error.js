/**
 * Custom application error class.
 *
 * `AppError` lets the centralized error handler distinguish between
 * expected, user-facing errors and unexpected exceptions. Every
 * business-logic failure that is not 500 must throw `AppError`.
 */
import { ERROR_CODES } from '../config/constants.js';

export class AppError extends Error {
  /**
   * @param {string} message - Human-readable message shown to the end user.
   * @param {number} statusCode - HTTP status code (e.g. 400, 403, 404, 422).
   * @param {keyof typeof ERROR_CODES} [code=ERROR_CODES.BAD_REQUEST] - Stable machine-readable code.
   * @param {unknown} [details] - Optional extra context (e.g. validation errors) used for debugging/logging.
   */
  constructor(message, statusCode = 400, code = ERROR_CODES.BAD_REQUEST, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
