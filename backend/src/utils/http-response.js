import { ERROR_CODES } from '../config/constants.js';

/**
 * Single place that defines the API response envelope.
 * Controllers must use these helpers so every response has the same shape.
 *
 * Success:
 *   { "success": true, "data": { ... } }
 * Error:
 *   { "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
 */

/**
 * Sends a successful response.
 * @param {import('express').Response} res
 * @param {{ data?: unknown, statusCode?: number, message?: string, meta?: object }} options
 */
export function sendSuccess(res, { data = null, statusCode = 200, message, meta } = {}) {
  const body = { success: true, data };

  if (message) body.message = message;
  if (meta) body.meta = meta;

  return res.status(statusCode).json(body);
}

/** 201 Created helper. */
export function sendCreated(res, data, message) {
  return sendSuccess(res, { data, statusCode: 201, message });
}

/** 204 No Content helper. */
export function sendNoContent(res) {
  return res.status(204).send();
}

/**
 * Sends an error response. Intended for use inside the error middleware.
 * @param {import('express').Response} res
 * @param {{ message?: string, code?: string, statusCode?: number, details?: unknown }} options
 */
export function sendError(
  res,
  { message = 'Something went wrong', code, statusCode = 500, details } = {}
) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code: code ?? ERROR_CODES.INTERNAL_SERVER_ERROR,
      message,
      ...(details ? { details } : {}),
    },
  });
}

export default { sendSuccess, sendCreated, sendNoContent, sendError };
