/**
 * CSRF protection.
 *
 * The session cookie is SameSite=Lax, which already stops a cross-site form
 * post from carrying it. This middleware is the second, defence-in-depth layer:
 * for every state-changing request that carries an `Origin` header, the origin
 * must match a known frontend origin or the server's own host. Browsers send
 * `Origin` on all POST/PATCH/DELETE, so a genuinely cross-site request is
 * rejected with 403 before it reaches a handler. Requests without an `Origin`
 * (curl, scripts, API clients) are allowed through because they are not
 * browser-driven and SameSite does not apply to them.
 */
import env from '../config/env.js';
import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  const sameHost = `${req.protocol}://${req.get('host')}`;
  const allowed = origin === sameHost || env.frontendOrigins.includes(origin);

  if (!allowed) {
    return next(
      new AppError('Cross-origin request rejected.', 403, ERROR_CODES.FORBIDDEN)
    );
  }

  return next();
}

export default { requireSameOrigin };