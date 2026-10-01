import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

/** Turns a ZodError into a compact, frontend-friendly array of field errors. */
function toFieldErrors(zodError) {
  return zodError.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Builds a validation middleware from Zod schemas.
 *
 * @example
 * router.post(
 *   '/',
 *   validateRequest({ body: createProductSchema }),
 *   controller.create
 * );
 *
 * Validated (and coerced) values replace the raw request values so
 * controllers never see unvalidated input.
 *
 * @param {{ body?: z.ZodTypeAny, params?: z.ZodTypeAny, query?: z.ZodTypeAny }} schemas
 */
export function validateRequest(schemas = {}) {
  return function validateMiddleware(req, res, next) {
    const errors = [];

    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        // Express 5 exposes `req.query` via a getter, so assign defensively.
        if (source === 'query') {
          Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true });
        } else {
          req[source] = result.data;
        }
      } else {
        errors.push(...toFieldErrors(result.error).map((e) => ({ ...e, source })));
      }
    }

    if (errors.length > 0) {
      return next(new AppError('Validation failed', 422, ERROR_CODES.VALIDATION_ERROR, { errors }));
    }

    return next();
  };
}

export default validateRequest;
