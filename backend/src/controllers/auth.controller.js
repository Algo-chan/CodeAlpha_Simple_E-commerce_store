/**
 * Auth controller — HTTP in, HTTP out for the customer account system.
 *
 * Identities come from the session cookie via `authenticate`, never from the
 * request body. The only new thing a controller does here is set and clear the
 * session cookie; everything else is a thin pass-through to the service so the
 * envelope stays uniform.
 */
import env from '../config/env.js';
import { SESSION_COOKIE_NAME } from '../config/constants.js';
import { asyncHandler } from '../utils/async-handler.js';
import { serializeCookie, clearCookie, readCookie } from '../utils/cookies.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/http-response.js';
import * as service from '../services/auth.service.js';

const SESSION_MAX_AGE_SECONDS = env.SESSION_TTL_HOURS * 3600;

/** Returns the request metadata recorded on a fresh session. */
function requestMeta(req) {
  const header = req.headers['user-agent'];
  return {
    userAgent: typeof header === 'string' ? header.slice(0, 255) : null,
    ipAddress: req.ip ?? null,
  };
}

/** Writes the httpOnly session cookie for a raw token. */
function setSessionCookie(res, token) {
  res.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE_NAME, token, {
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
      isSecure: env.isProduction,
    })
  );
}

/** `POST /api/v1/auth/register` */
export const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;
  const { user, token } = await service.register(req.db, {
    name,
    email,
    phone,
    password,
    ...requestMeta(req),
  });
  setSessionCookie(res, token);
  sendCreated(res, { user }, 'Account created. Welcome.');
});

/** `POST /api/v1/auth/login` */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, token } = await service.login(req.db, {
    email,
    password,
    ...requestMeta(req),
  });
  setSessionCookie(res, token);
  sendSuccess(res, { user });
});

/** `POST /api/v1/auth/logout` — idempotent: clears the cookie either way. */
export const logout = asyncHandler(async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  await service.logout(req.db, token);
  clearCookie(res, SESSION_COOKIE_NAME);
  sendNoContent(res);
});

/** `GET /api/v1/auth/me` — session already resolved by `authenticate`. */
export const me = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user });
});

/** `PATCH /api/v1/auth/profile` */
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await service.updateProfile(req.db, req.user.id, req.body);
  sendSuccess(res, { user });
});

/** `POST /api/v1/auth/password` */
export const changePassword = asyncHandler(async (req, res) => {
  await service.changePassword(req.db, req.user.id, req.session.tokenHash, req.body);
  sendSuccess(res, null, 'Password updated.');
});

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

export const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await service.listAddresses(req.db, req.user.id);
  sendSuccess(res, { addresses });
});

export const createAddress = asyncHandler(async (req, res) => {
  const address = await service.createAddress(req.db, req.user.id, req.body);
  sendCreated(res, { address });
});

export const updateAddress = asyncHandler(async (req, res) => {
  const address = await service.updateAddress(req.db, req.user.id, req.params.id, req.body);
  sendSuccess(res, { address });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const address = await service.deleteAddress(req.db, req.user.id, req.params.id);
  sendSuccess(res, { address });
});

export const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await service.setDefaultAddress(req.db, req.user.id, req.params.id);
  sendSuccess(res, { address });
});

export default {
  register,
  login,
  logout,
  me,
  updateProfile,
  changePassword,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};