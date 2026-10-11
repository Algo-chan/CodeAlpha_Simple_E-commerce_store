/**
 * Shared helpers for the admin services.
 *
 * Small and boring on purpose. Paging bounds, a 404 factory, a slug deriver and
 * the pagination envelope are used by every management service, and having one
 * copy means the admin API reports page counts the same way everywhere.
 */
import { AppError } from '../../utils/app-error.js';
import { ERROR_CODES, PAGINATION } from '../../config/constants.js';

/** Clamps a requested page size to the shared pagination bounds. */
export function resolvePaging({ page, limit } = {}) {
  const safePage = Math.max(1, Number(page) || PAGINATION.DEFAULT_PAGE);
  const safeLimit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, Number(limit) || PAGINATION.DEFAULT_LIMIT)
  );
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

/** The `meta.pagination` block every admin list returns. */
export function paginationMeta({ page, limit, total, returned = 0 }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage: (page - 1) * limit + returned < total,
    hasPreviousPage: page > 1,
  };
}

/** A 404 carrying the store's standard error code. */
export function notFound(message) {
  return new AppError(message, 404, ERROR_CODES.NOT_FOUND);
}

/** A 422 for a rule the schema cannot express (a cycle, a cross-field rule). */
export function unprocessable(message) {
  return new AppError(message, 422, ERROR_CODES.UNPROCESSABLE_ENTITY);
}

/** A 409 for a uniqueness clash the database would otherwise report generically. */
export function conflict(message) {
  return new AppError(message, 409, ERROR_CODES.CONFLICT);
}

/**
 * Derives a URL slug from a display name.
 *
 * Lower-cases, strips diacritics, and collapses runs of non-alphanumerics into a
 * single hyphen. A name that is entirely non-Latin (for example an Amharic
 * brand) reduces to an empty string; the caller must then require an explicit
 * slug rather than persist an empty one.
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Resolves the slug to persist: the supplied one, or one derived from `name`. */
export function resolveSlug(input, name) {
  const supplied = input.slug?.trim();
  const slug = supplied && supplied.length > 0 ? supplied : slugify(name);
  if (!slug) {
    throw unprocessable('A slug is required because one could not be derived from the name.');
  }
  return slug;
}

export default {
  resolvePaging,
  paginationMeta,
  notFound,
  unprocessable,
  conflict,
  slugify,
  resolveSlug,
};
