import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

/** Handles requests to undefined endpoints (404). */
export function notFoundHandler(req, res, next) {
  const message = `Route ${req.method} ${req.originalUrl} not found`;
  next(new AppError(message, 404, ERROR_CODES.NOT_FOUND));
}

export default notFoundHandler;
