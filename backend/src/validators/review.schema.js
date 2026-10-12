/**
 * Review request schemas — the customer-facing write side.
 *
 * The body anchors the review to a purchase (`order_item_id`) and carries the
 * words and stars; everything else (the product, the verified-purchase fact)
 * is derived server-side. Zod strips anything undeclared, so a client cannot
 * smuggle in a `product_id`, a `user_id` or a `status` — the service decides
 * every one of those itself.
 *
 * The "some text" rule mirrors the `reviews_needs_some_text` CHECK in
 * migration 017: a rating alone is not a review, at least a title or a comment
 * is required.
 */
import { z } from 'zod';
import { shortTextSchema } from './common.schema.js';

const uuidSchema = z.string().trim().uuid({ message: 'Must be a valid id' });

export const createReviewSchema = z
  .object({
    order_item_id: uuidSchema,
    rating: z.coerce
      .number()
      .int({ message: 'Rating must be a whole number of stars.' })
      .min(1, { message: 'Pick at least 1 star.' })
      .max(5, { message: 'Rating is out of 5 stars.' }),
    title: shortTextSchema(120).optional(),
    comment: z
      .string()
      .trim()
      .max(2000, { message: 'Comment is too long (2000 characters max).' })
      .optional(),
  })
  .strip()
  .refine((body) => Boolean(body.title?.trim()) || Boolean(body.comment?.trim()), {
    message: 'Add a few words so your review says something.',
    path: ['comment'],
  });

export default { createReviewSchema };
