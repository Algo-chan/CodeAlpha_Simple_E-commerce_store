/**
 * Admin request schemas (Phase 10).
 *
 * Every store-management endpoint validates its input here before a service
 * sees it, so a controller never reads an uncoerced value. Two conventions
 * follow the rest of the codebase:
 *
 *   `.strip()` on write bodies, so a client cannot smuggle in a field the
 *   service did not intend to set (an `id`, a `created_at`, a stock figure).
 *
 *   `.partial()` for PATCH, so an update carries only what changed and the
 *   service can merge it without inventing values for the rest.
 *
 * The enums are built from the constants module, which mirrors the database
 * CHECK constraints. A value that is not in both is rejected before the
 * database would have to reject it.
 */
import { z } from 'zod';
import {
  ADMIN_ADJUSTMENT_TYPES,
  ADMIN_LIMITS,
  COUPON_TYPE,
  CUSTOMER_STATUS,
  ORDER_STATUS,
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  REVIEW_STATUS,
} from '../config/constants.js';
import { paginationSchema, shortTextSchema } from './common.schema.js';
import { orderNumberParamSchema } from './checkout.schema.js';

const uuidSchema = z.string().trim().uuid({ message: 'Must be a valid id' });

/** `:id` route parameter. */
export const uuidIdParamSchema = z.object({ id: uuidSchema });

/** `:variantId` route parameter. */
export const variantIdParamSchema = z.object({ variantId: uuidSchema });

/** `:imageId` route parameter. */
export const imageIdParamSchema = z.object({ imageId: uuidSchema });

/** `:orderNumber` route parameter, identical to the customer surface. */
export const orderNumberAdminParamSchema = orderNumberParamSchema;

/**
 * A slug the database's `products_slug_format` / `categories_slug_format`
 * CHECK will accept: lower-case alphanumerics joined by single hyphens.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lower-case words separated by hyphens')
  .max(220);

const attributesSchema = z
  .record(
    z.string().trim().min(1).max(ADMIN_LIMITS.MAX_ATTRIBUTE_KEY),
    z.string().max(ADMIN_LIMITS.MAX_ATTRIBUTE_VALUE)
  )
  .refine(
    (value) => Object.keys(value).length <= ADMIN_LIMITS.MAX_ATTRIBUTES,
    `A variant may carry at most ${ADMIN_LIMITS.MAX_ATTRIBUTES} attributes`
  );

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

export const adminProductQuerySchema = paginationSchema.extend({
  status: z.enum(Object.values(PRODUCT_STATUS)).optional(),
  productType: z.enum(Object.values(PRODUCT_TYPE)).optional(),
  categoryId: uuidSchema.optional(),
});

const productBodySchema = z
  .object({
    name: shortTextSchema(200),
    slug: slugSchema.optional(),
    description: z.string().trim().max(5000).optional(),
    productType: z.enum(Object.values(PRODUCT_TYPE)).optional(),
    brand: shortTextSchema(80).optional(),
    categoryId: uuidSchema.nullable().optional(),
    status: z.enum(Object.values(PRODUCT_STATUS)).optional(),
  })
  .strip();

export const createProductSchema = productBodySchema;

export const updateProductSchema = productBodySchema.partial();

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

const priceSchema = z.coerce
  .number()
  .int('Price must be a whole number of minor units')
  .min(0, 'Price cannot be negative')
  .max(1_000_000_000_000, 'Price is out of range');

const variantBodySchema = z
  .object({
    sku: shortTextSchema(64),
    price: priceSchema,
    compareAtPrice: priceSchema.nullable().optional(),
    attributes: attributesSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strip();

export const createVariantSchema = variantBodySchema;

export const updateVariantSchema = variantBodySchema.partial();

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

const imageBodySchema = z
  .object({
    imageUrl: z.string().trim().min(1).max(2000),
    altText: z.string().trim().max(255).optional(),
    sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strip();

export const createImageSchema = imageBodySchema;

export const updateImageSchema = imageBodySchema.partial();

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

const categoryBodySchema = z
  .object({
    name: shortTextSchema(120),
    slug: slugSchema.optional(),
    parentId: uuidSchema.nullable().optional(),
    description: z.string().trim().max(5000).optional(),
    imageUrl: z.string().trim().max(2000).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
    isActive: z.boolean().optional(),
  })
  .strip();

export const createCategorySchema = categoryBodySchema;

export const updateCategorySchema = categoryBodySchema.partial();

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A stock adjustment.
 *
 * `quantity` is the SIZE of the movement, always given as a positive number.
 * The service derives the sign from `type` (RESTOCK/RETURN add, DAMAGE
 * removes), except for ADJUSTMENT, where the correction itself may go either
 * way and the client supplies a signed figure. Signing inside the service is
 * what stops a well-meant "restock -5" from silently removing stock.
 */
export const adjustInventorySchema = z
  .object({
    type: z.enum(ADMIN_ADJUSTMENT_TYPES),
    quantity: z.coerce.number().int('Quantity must be a whole number'),
    note: z.string().trim().max(500).optional(),
  })
  .strip()
  .superRefine((value, ctx) => {
    if (value.quantity === 0) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity cannot be zero' });
      return;
    }
    if (Math.abs(value.quantity) > ADMIN_LIMITS.MAX_STOCK_DELTA) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Quantity is out of range',
      });
    }
    if (value.type !== 'ADJUSTMENT' && value.quantity < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Quantity must be positive for this movement type',
      });
    }
  });

export const updateReorderLevelSchema = z
  .object({
    reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
  })
  .strip();

export const adminInventoryQuerySchema = paginationSchema.extend({
  lowStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Orders, customers, reviews, payments                                        */
/* -------------------------------------------------------------------------- */

export const adminOrderQuerySchema = paginationSchema.extend({
  status: z.enum(Object.values(ORDER_STATUS)).optional(),
  paymentStatus: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED']).optional(),
});

export const updateOrderStatusSchema = z
  .object({
    status: z.enum(Object.values(ORDER_STATUS)),
    note: z.string().trim().max(500).optional(),
  })
  .strip();

export const adminCustomerQuerySchema = paginationSchema.extend({
  status: z.enum(Object.values(CUSTOMER_STATUS)).optional(),
  role: z.enum(['CUSTOMER', 'ADMIN', 'SELLER']).optional(),
});

export const updateCustomerStatusSchema = z
  .object({
    status: z.enum([CUSTOMER_STATUS.ACTIVE, CUSTOMER_STATUS.SUSPENDED]),
  })
  .strip();

export const adminReviewQuerySchema = paginationSchema.extend({
  status: z.enum(Object.values(REVIEW_STATUS)).optional(),
});

export const moderateReviewSchema = z
  .object({
    status: z.enum([REVIEW_STATUS.APPROVED, REVIEW_STATUS.REJECTED]),
    note: z.string().trim().max(500).optional(),
  })
  .strip();

export const adminPaymentQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  provider: z.string().trim().max(40).optional(),
  method: z.enum(['COD', 'ONLINE']).optional(),
});

export const adminAuditQuerySchema = paginationSchema.extend({
  entityType: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
  actorId: uuidSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* Coupons                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Codes are stored upper-cased and space-free (migration 023), so the validator
 * normalises them the same way the repository does. `value` means a whole
 * percentage for PERCENT and an amount in minor units for FIXED; which one is
 * enforced by the `discountType` enum and cross-field rules in the service.
 */
const couponCodeSchema = z
  .string()
  .trim()
  .min(1, 'A coupon code is required')
  .max(ADMIN_LIMITS.MAX_COUPON_CODE)
  .transform((value) => value.toUpperCase().replace(/\s+/g, ''))
  .refine((value) => value.length > 0, 'A coupon code is required');

const couponValueSchema = z.coerce
  .number()
  .int('Discount value must be a whole number')
  .min(1, 'Discount value must be positive')
  .max(ADMIN_LIMITS.MAX_COUPON_VALUE_MINOR, 'Discount value is out of range');

const couponBodySchema = z
  .object({
    code: couponCodeSchema,
    description: z.string().trim().max(ADMIN_LIMITS.MAX_COUPON_DESCRIPTION).nullable().optional(),
    discountType: z.enum(Object.values(COUPON_TYPE)),
    discountValue: couponValueSchema,
    minSubtotal: z.coerce.number().int().min(0).max(ADMIN_LIMITS.MAX_COUPON_VALUE_MINOR).optional(),
    maxDiscount: couponValueSchema.nullable().optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    maxUses: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    perUserLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strip();

export const createCouponSchema = couponBodySchema;

export const updateCouponSchema = couponBodySchema.partial();

export const adminCouponQuerySchema = paginationSchema.extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export default {
  uuidIdParamSchema,
  variantIdParamSchema,
  imageIdParamSchema,
  orderNumberAdminParamSchema,
  adminProductQuerySchema,
  createProductSchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema,
  createImageSchema,
  updateImageSchema,
  createCategorySchema,
  updateCategorySchema,
  adjustInventorySchema,
  updateReorderLevelSchema,
  adminInventoryQuerySchema,
  adminOrderQuerySchema,
  updateOrderStatusSchema,
  adminCustomerQuerySchema,
  updateCustomerStatusSchema,
  adminReviewQuerySchema,
  moderateReviewSchema,
  adminPaymentQuerySchema,
  adminAuditQuerySchema,
  createCouponSchema,
  updateCouponSchema,
  adminCouponQuerySchema,
};
