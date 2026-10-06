/**
 * Cookie helpers.
 *
 * Browsers, not Node, parse and emit cookies, so only two things are needed on
 * the server: reading `Cookie` without a dependency, and writing `Set-Cookie`
 * with the security attributes the auth layer requires. The serialization is a
 * deliberate subset of the RFC — none of the tricks (quoting, expires dates)
 * are needed because the session token is a base64url string and the session
 * lifetime maps cleanly onto `Max-Age`.
 */

/**
 * Reads a single cookie value by name.
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string|null}
 */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Builds the `Set-Cookie` value for a session token.
 *
 * @param {string} name
 * @param {string} value
 * @param {{ maxAgeSeconds?: number, isSecure?: boolean }} [options]
 * @returns {string}
 */
export function serializeCookie(name, value, { maxAgeSeconds, isSecure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (typeof maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  }
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Clears a cookie by expiring it immediately.
 * @param {import('express').Response} res
 * @param {string} name
 */
export function clearCookie(res, name) {
  res.append('Set-Cookie', serializeCookie(name, '', { maxAgeSeconds: 0 }));
}

export default { readCookie, serializeCookie, clearCookie };