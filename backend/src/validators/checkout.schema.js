/**
 * Checkout and order request schemas.
 *
 * The body is shaped like the `addresses` endpoint the shopper already used
 * (`full_name`, `phone`, `city`, `area`, `street`, ...) plus the order's own
 * `email`, `customer_notes` and `payment_method`. Zod strips anything not
 * declared here, so a client cannot smuggle in `total`, `status`,
 * `payment_status` or a `user_id` — the service computes or resolves every one
 * of those itself.
 *
 * `full_name`, `email` and `phone` are optional because a signed-in customer
 * can fall back to their account; the service raises a 422 if a guest omits
 * them. `city` and `street` are mandatory because the shipping snapshot's
 * database CHECK requires a non-empty city and a deliverable street.
 *
 * `payment_method` accepts only `COD`. Cash on delivery is the sole real method
 * in this phase; `ONLINE` is reserved in the schema but must not be reachable
 * until a provider exists, so the enum deliberately excludes it.
 */
import { z } from 'zod';
import { CHECKOUT_LIMITS } from '../config/constants.js';
import { emailSchema, shortTextSchema } from './common.schema.js';
import { phoneSchema } from './auth.schema.js';

export const checkoutSchema = z
  .object({
    full_name: shortTextSchema(120).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    label: shortTextSchema(60).optional(),
    city: shortTextSchema(80),
    area: shortTextSchema(80),
    street: shortTextSchema(160),
    landmark: shortTextSchema(160).optional(),
    additional_notes: z.string().trim().max(CHECKOUT_LIMITS.MAX_NOTES).optional(),
    customer_notes: z.string().trim().max(CHECKOUT_LIMITS.MAX_NOTES).optional(),
    payment_method: z
      .enum(['COD'], {
        message: 'Only cash on delivery is available.',
      })
      .default('COD'),
  })
  .strip();

/** `:orderNumber` route parameter, e.g. `ORD-20260115-0001`. */
export const orderNumberParamSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .regex(/^ORD-\d{8}-\d{4}$/, 'Order number must look like ORD-YYYYMMDD-NNNN'),
});

export default { checkoutSchema, orderNumberParamSchema };
