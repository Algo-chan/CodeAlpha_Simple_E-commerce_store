/**
 * Auth service — account lifecycle and authentication decisions.
 *
 * This is where credentials are checked, sessions are minted and cancelled,
 * and the "what a user may change" rules live. Controllers stay thin because
 * every branch here is a security decision with a message attached.
 *
 * The token returned by `register`/`login` is the raw value for the cookie; it
 * is hashed before storage and is never persisted in plain form.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import { ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';
import { hashPassword, verifyPassword, verifyPasswordTimingSafe } from './password.js';
import * as users from '../repositories/user.repository.js';
import * as sessions from '../repositories/session.repository.js';
import * as addressesRepo from '../repositories/address.repository.js';

/** Generic message for both "no such account" and "wrong password". */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

/** The only columns a customer payload may ever contain. */
export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    last_login_at: row.last_login_at,
    password_changed_at: row.password_changed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** One client-facing frame for a delivery address row. */
function serializeAddress(row) {
  if (!row) return null;
  const { user_id, ...address } = row;
  void user_id;
  return address;
}

/**
 * Creates a session for a user. Returns the raw cookie token.
 * @param {object} db
 * @param {object} user
 * @param {{ userAgent: string|null, ipAddress: string|null }} meta
 */
async function createSession(db, user, { userAgent, ipAddress }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await sessions.create(db, {
    userId: user.id,
    tokenHash: sessions.hashToken(token),
    expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000),
    userAgent,
    ipAddress,
  });
  return token;
}

/* -------------------------------------------------------------------------- */
/* Registration / login / logout                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} db
 * @param {{ name: string, email: string, phone: string, password: string,
 *           userAgent: string|null, ipAddress: string|null }} input
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function register(db, input) {
  const { name, phone, password, userAgent, ipAddress } = input;
  const email = input.email;

  const existing = await users.findByEmail(db, email);
  if (existing) {
    throw new AppError('An account with this email already exists.', 409, ERROR_CODES.CONFLICT);
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await users.create(db, { name, email, phone, passwordHash });
  } catch (error) {
    // The pre-check is an optimisation and a friendly message; the unique index
    // is the real guarantee against racing registrations.
    if (error.code === '23505') {
      throw new AppError('An account with this email already exists.', 409, ERROR_CODES.CONFLICT);
    }
    throw error;
  }

  const token = await createSession(db, user, { userAgent, ipAddress });
  return { user: sanitizeUser(user), token };
}

/**
 * @param {object} db
 * @param {{ email: string, password: string, userAgent: string|null, ipAddress: string|null }} input
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function login(db, input) {
  const { password, userAgent, ipAddress } = input;
  const email = input.email;

  const user = await users.findByEmail(db, email);

  const match = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPasswordTimingSafe(password, null);

  if (!user || !match) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401, ERROR_CODES.UNAUTHORIZED);
  }

  if (user.status !== 'ACTIVE') {
    throw new AppError(
      'This account is suspended. Contact support for help.',
      403,
      ERROR_CODES.FORBIDDEN
    );
  }

  const token = await createSession(db, user, { userAgent, ipAddress });
  await users.setLastLogin(db, user.id);

  return { user: sanitizeUser(user), token };
}

/**
 * Cancels the session and reports whether anything was actually revoked
 * (so the controller can clear the cookie regardless).
 *
 * @param {object} db
 * @param {string|null} token
 * @returns {Promise<boolean>}
 */
export async function logout(db, token) {
  if (!token) return false;
  const destroyed = await sessions.deleteByTokenHash(db, sessions.hashToken(token));
  return destroyed;
}

/**
 * Resolves a raw cookie token to a live session + user, or null.
 * Used by the `authenticate` middleware.
 *
 * @param {object} db
 * @param {string} token
 * @returns {Promise<{ session: object, user: object }|null>}
 */
export async function resolveSession(db, token) {
  const { session, user } = await sessions.findByTokenHash(db, sessions.hashToken(token));
  if (!session || !user) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return { session, user };
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} db
 * @param {string} userId
 * @param {{ name?: string, phone?: string }} fields
 */
export async function updateProfile(db, userId, fields) {
  const row = await users.updateProfile(db, userId, fields);
  if (!row) throw new AppError('Account not found.', 404, ERROR_CODES.NOT_FOUND);
  return sanitizeUser(row);
}

/**
 * Changes the password after verifying the current one. Every other session is
 * revoked so a leaked token from another device no longer works; the current
 * session survives because the shopper is clearly the one typing.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} currentSessionTokenHash
 * @param {{ currentPassword: string, newPassword: string }} input
 */
export async function changePassword(db, userId, currentSessionTokenHash, input) {
  const user = await users.findById(db, userId);
  if (!user) throw new AppError('Account not found.', 404, ERROR_CODES.NOT_FOUND);

  const valid = await verifyPassword(input.currentPassword, user.password_hash);
  if (!valid) {
    throw new AppError('Your current password is incorrect.', 400, ERROR_CODES.BAD_REQUEST);
  }

  const passwordHash = await hashPassword(input.newPassword);
  await users.updatePassword(db, userId, passwordHash);
  await revokeOtherSessions(db, userId, currentSessionTokenHash);
}

/**
 * @param {object} db
 * @param {string} userId
 * @param {string|null} keepTokenHash sessions to preserve (the current one)
 */
export async function revokeOtherSessions(db, userId, keepTokenHash) {
  await sessions.deleteAllForUser(db, userId, keepTokenHash);
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

export async function listAddresses(db, userId) {
  const rows = await addressesRepo.listByUser(db, userId);
  return rows.map(serializeAddress);
}

export async function createAddress(db, userId, input) {
  const row = await addressesRepo.create(db, { userId, ...input });
  return serializeAddress(row);
}

export async function updateAddress(db, userId, id, input) {
  const row = await addressesRepo.update(db, id, userId, input);
  if (!row) {
    throw new AppError('Address not found.', 404, ERROR_CODES.NOT_FOUND);
  }
  return serializeAddress(row);
}

export async function deleteAddress(db, userId, id) {
  const row = await addressesRepo.remove(db, id, userId);
  if (!row) {
    throw new AppError('Address not found.', 404, ERROR_CODES.NOT_FOUND);
  }
  return serializeAddress(row);
}

export async function setDefaultAddress(db, userId, id) {
  const row = await addressesRepo.setDefault(db, id, userId);
  if (!row) {
    throw new AppError('Address not found.', 404, ERROR_CODES.NOT_FOUND);
  }
  return serializeAddress(row);
}

export default {
  register,
  login,
  logout,
  resolveSession,
  updateProfile,
  changePassword,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  sanitizeUser,
};
