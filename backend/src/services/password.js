/**
 * Password hashing.
 *
 * bcrypt via `bcryptjs` (pure JavaScript, no native addon, so installs and runs
 * identically on every platform). The database's `users_password_hash_is_hashed`
 * CHECK expects a modular-crypt string (`$2b$...`), which is exactly what
 * bcryptgenSalt/hash produce.
 *
 * A fixed dummy hash equalizes the timing of a failed login against an unknown
 * email: looking up a nonexistent user is fast, running bcrypt against a wrong
 * password is not, and the difference is a user-enumeration side channel.
 */
import bcrypt from 'bcryptjs';
import env from '../config/env.js';

/** Cost factor for new hashes. Production reduces rarely; speed here is fine. */
const SALT_ROUNDS = env.BCRYPT_SALT_ROUNDS;

/**
 * A well-formed but uncrackable hash used only when the account does not exist,
 * so `verifyPassword` always does one full bcrypt comparison.
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 6);

/** @param {string} password */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Runs one full bcrypt comparison regardless of whether `hash` is real,
 * so callers get uniform timing for known and unknown accounts.
 * @param {string} password
 * @param {string|null} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPasswordTimingSafe(password, hash) {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}

export default { hashPassword, verifyPassword, verifyPasswordTimingSafe };
