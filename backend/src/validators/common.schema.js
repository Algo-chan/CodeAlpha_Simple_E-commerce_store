import { z } from 'zod';
import { PAGINATION } from '../config/constants.js';

/**
 * Shared, reusable Zod schemas.
 * These are building blocks for endpoint-specific validators in this folder.
 */

/** `:id` route parameter (numeric primary keys by convention). */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive({ message: 'id must be a positive integer' }),
});

/** Standard `?page=&limit=&sort=&order=&search=` list query. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  sort: z.string().trim().max(50).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(120).optional(),
});

/** Reusable email field (used by auth/users validators later). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'A valid email address is required' })
  .max(255);

/** Reusable non-empty trimmed string with a maximum length. */
export const shortTextSchema = (max = 255) => z.string().trim().min(1).max(max);

export default { idParamSchema, paginationSchema, emailSchema, shortTextSchema };
