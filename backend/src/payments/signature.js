/**
 * Webhook signature helpers.
 *
 * Every provider signs the exact bytes it posts. A server must verify against
 * those raw bytes, not a re-serialised copy of the parsed body, because JSON
 * key order and whitespace are not stable across a parse/stringify round-trip.
 * The route therefore hands the provider the raw buffer captured before
 * `express.json` parsed it (see `app.js`).
 *
 * The signed message is `${timestamp}.${body}` so a captured request cannot be
 * replayed later without also forging a fresh timestamp; the caller bounds how
 * old a timestamp may be.
 */
import crypto from 'node:crypto';

/**
 * @param {string} secret
 * @param {string|Buffer} payload
 * @param {string|number} timestamp
 * @returns {string} lowercase hex HMAC-SHA256
 */
export function signPayload(secret, payload, timestamp) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

/** Constant-time comparison that never throws on length mismatch. */
function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Accepts `sha256=<hex>` as well as a bare hex digest. */
function stripPrefix(signature) {
  const text = String(signature).trim();
  const separator = text.indexOf('=');
  return (separator === -1 ? text : text.slice(separator + 1)).trim();
}

/**
 * Verifies a signed notification.
 *
 * @param {{
 *   secret: string,
 *   rawBody: string|Buffer,
 *   signature: string|undefined,
 *   timestamp: string|undefined,
 *   toleranceSeconds?: number,
 *   nowSeconds?: number,
 * }} input
 * @returns {boolean} true only when the signature matches and is fresh
 */
export function verifySignature({
  secret,
  rawBody,
  signature,
  timestamp,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!secret) return false;
  if (!signature || timestamp === undefined || timestamp === null || timestamp === '') return false;

  const issuedAt = Number(timestamp);
  if (Number.isFinite(issuedAt) && toleranceSeconds > 0) {
    if (Math.abs(nowSeconds - issuedAt) > toleranceSeconds) return false;
  }

  const expected = signPayload(secret, rawBody ?? '', timestamp);
  return timingSafeEqual(expected, stripPrefix(signature));
}

export default { signPayload, verifySignature };
