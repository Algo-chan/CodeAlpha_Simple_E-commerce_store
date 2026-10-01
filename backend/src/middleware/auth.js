import { ERROR_CODES, ROLES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Extracts a bearer token from the Authorization header.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Authentication middleware placeholder.
 *
 * The token verification logic will live in `services/auth.service.js`.
 * Because JWT verification is intentionally NOT implemented yet, this
 * middleware rejects all requests with 501 NOT_IMPLEMENTED so the architecture
 * is visible but never silently insecure.
 *
 * TODO(auth): replace the body below with a real JWT verification call.
 */
export function authenticate(req, res, next) {
  if (env.isTest) {
    return next(
      new AppError('Authentication is not implemented yet', 501, ERROR_CODES.NOT_IMPLEMENTED)
    );
  }

  const token = extractBearerToken(req);
  if (!token) {
    return next(
      new AppError('Missing or malformed Authorization header', 401, ERROR_CODES.UNAUTHORIZED)
    );
  }

  // TODO(auth): verify signature + expiry, load the user, attach to req.user.
  logger.debug('Authentication placeholder reached', { hasToken: Boolean(token) });
  return next(
    new AppError('Authentication is not implemented yet', 501, ERROR_CODES.NOT_IMPLEMENTED)
  );
}

/**
 * Role-based access control.
 * Must run AFTER `authenticate` so that `req.user` exists.
 *
 * @example
 * router.get('/', authenticate, authorize(ROLES.ADMIN), controller)
 *
 * @param {...string} allowedRoles
 */
export function authorize(...allowedRoles) {
  const validRoles = Object.values(ROLES);
  const requested = allowedRoles.flat();

  for (const role of requested) {
    if (!validRoles.includes(role)) {
      console.error(`[authorize] Unknown role "${role}". Known roles: ${validRoles.join(', ')}`);
    }
  }

  return function authorizeMiddleware(req, res, next) {
    // Auth placeholder never populates req.user, so fail closed with 501.
    if (!req.user) {
      return next(
        new AppError('Authentication is not implemented yet', 501, ERROR_CODES.NOT_IMPLEMENTED)
      );
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
    const isAllowed = requested.some((role) => userRoles.includes(role));

    if (!isAllowed) {
      return next(
        new AppError(
          'You do not have permission to perform this action',
          403,
          ERROR_CODES.FORBIDDEN
        )
      );
    }

    return next();
  };
}

export default { authenticate, authorize, extractBearerToken };
