/**
 * Application-wide constants.
 * Anything used by more than one layer lives here so that magic strings and
 * magic numbers stay in a single, searchable place.
 */

/** Base mount point for every API version, e.g. `/api`. */
export const API_PREFIX = '/api';

/** HTTP-only cookie name that carries the authentication session token. */
export const SESSION_COOKIE_NAME = 'ecom_session';

/** Current API version. Bumping this to `v2` keeps `v1` alive for old clients. */
export const API_VERSION = 'v1';

/** Full base path of the current API, e.g. `/api/v1`. */
export const API_BASE_PATH = `${API_PREFIX}/${API_VERSION}`;

/** Access levels understood by the authorization middleware. */
export const ROLES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
  SELLER: 'SELLER',
});

/**
 * Stable, machine-readable error codes returned by the API.
 * Clients switch on these; humans read `message`.
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
});

/** Default and maximum page sizes for list endpoints. */
export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
});
