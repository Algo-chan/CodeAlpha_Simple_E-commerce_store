/**
 * Wishlist request schemas.
 */
import { z } from 'zod';
import { WISHLIST_LIMITS } from '../config/constants.js';

const uuid = (label) => z.string().uuid({ message: `${label} must be a valid UUID` });

export const addWishlistItemSchema = z
  .object({
    productId: uuid('productId'),
  })
  .strip();

export const wishlistItemParamSchema = z.object({
  productId: uuid('productId'),
});

export const mergeWishlistSchema = z
  .object({
    productIds: z
      .array(uuid('productIds[]'))
      .min(1, 'Send at least one product id')
      .max(WISHLIST_LIMITS.MAX_MERGE_IDS, {
        message: `A merge may carry at most ${WISHLIST_LIMITS.MAX_MERGE_IDS} products`,
      }),
  })
  .strip();

export default { addWishlistItemSchema, wishlistItemParamSchema, mergeWishlistSchema };
