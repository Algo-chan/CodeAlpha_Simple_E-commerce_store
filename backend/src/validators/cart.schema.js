/**
 * Cart request schemas.
 *
 * The client submits only WHAT to buy (`variantId`, `quantity`). Prices are
 * never accepted: even if a client sends `price`, the default strip mode of
 * the object schema drops it before the controller runs, and the service
 * reads the authoritative price from `product_variants` regardless.
 */
import { z } from 'zod';
import { CART_LIMITS } from '../config/constants.js';

const uuid = (label) => z.string().uuid({ message: `${label} must be a valid UUID` });

export const cartItemIdParamSchema = z.object({
  id: uuid('Cart item id'),
});

export const addItemSchema = z
  .object({
    variantId: uuid('variantId'),
    quantity: z.coerce
      .number()
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1')
      .max(CART_LIMITS.MAX_QUANTITY_PER_LINE, {
        message: `Quantity cannot exceed ${CART_LIMITS.MAX_QUANTITY_PER_LINE}`,
      })
      .default(1),
  })
  .strip();

export const updateItemSchema = z.object({
  quantity: z.coerce
    .number()
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(CART_LIMITS.MAX_QUANTITY_PER_LINE, {
      message: `Quantity cannot exceed ${CART_LIMITS.MAX_QUANTITY_PER_LINE}`,
    }),
});

export default { cartItemIdParamSchema, addItemSchema, updateItemSchema };
