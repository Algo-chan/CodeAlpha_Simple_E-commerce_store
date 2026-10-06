/**
 * Authentication & authorization middleware.
 *
 * `authenticate` resolves the httpOnly session cookie against the sessions
 * table and attaches the validated user to the request. Every account route
 * runs behind it, so controllers never trust a client-supplied user id: the
 * identity always comes from the session.
 *
 * `authorize` is the role gate. It must run AFTER `authenticate`.
 */
import { ERROR_CODES, ROLES, SESSION_COOKIE_NAME } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';
import { readCookie } from '../utils/cookies.js';
import { resolveSession, sanitizeUser } from '../services/auth.service.js';

/**
 * Required authentication: 401 without a valid session, 403 for a session
 * whose account has since been suspended.
 */
export function authenticate(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (!token) {
    return next(
      new AppError('You must be signed in to access this resource.', 401, ERROR_CODES.UNAUTHORIZED)
    );
  }

  return resolveSession(req.db, token)
    .then((resolved) => {
      if (!resolved) {
        return next(
          new AppError('Your session has expired. Please sign in again.', 401, ERROR_CODES.UNAUTHORIZED)
        );
      }
      if (resolved.user.status !== 'ACTIVE') {
        return next(
          new AppError('This account is suspended. Contact support for help.', 403, ERROR_CODES.FORBIDDEN)
        );
      }
      req.session = resolved.session;
      req.user = sanitizeUser(resolved.user);
      return next();
    })
    .catch((error) => next(error));
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
    if (!req.user) {
      return next(
        new AppError('Authentication required.', 401, ERROR_CODES.UNAUTHORIZED)
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

export default { authenticate, authorize };