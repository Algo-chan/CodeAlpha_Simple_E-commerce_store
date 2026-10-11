/**
 * Payment request schemas.
 *
 * The only input a shopper ever sends to the payment layer is which of their
 * own orders to pay. Amount, currency, provider and totals all come from the
 * database; a client cannot propose any of them.
 *
 * The webhook endpoint intentionally has NO body schema: the notification is a
 * signed, provider-shaped document that each adapter parses and the store
 * verifies against its own rows. Zod-stripping it here would fight the
 * adapters' own contracts.
 */
import { z } from 'zod';

/** `POST /api/v1/payments` — start online payment for one of my orders. */
export const paymentInitSchema = z
  .object({
    order_number: z
      .string()
      .trim()
      .regex(/^ORD-\d{8}-\d{4}$/),
  })
  .strip();

/** `:provider` in the webhook path, matched case-insensitively by the registry. */
export const providerParamSchema = z.object({
  provider: z.string().trim().min(1).max(40),
});

export default { paymentInitSchema, providerParamSchema };
