/**
 * Application-wide constants.
 * Anything used by more than one layer lives here so that magic strings and
 * magic numbers stay in a single, searchable place.
 */

/** Base mount point for every API version, e.g. `/api`. */
export const API_PREFIX = '/api';

/** HTTP-only cookie name that carries the authentication session token. */
export const SESSION_COOKIE_NAME = 'ecom_session';

/** HTTP-only cookie name that carries the guest cart session token. */
export const CART_COOKIE_NAME = 'ecom_cart';

/** Lifetime of a guest cart (and its cookie), in seconds: 30 days. */
export const GUEST_CART_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Cart limits. The upper bound mirrors the `cart_items_quantity_sane` CHECK
 * constraint so a violation is a clean 422 instead of a database error.
 */
export const CART_LIMITS = Object.freeze({
  MAX_QUANTITY_PER_LINE: 100,
  MAX_LINES: 50,
});

/** Upper bound on how many product ids one wishlist merge call may carry. */
export const WISHLIST_LIMITS = Object.freeze({
  MAX_ITEMS: 200,
  MAX_MERGE_IDS: 200,
});

/**
 * Fulfilment lifecycle of an order. These values match the
 * `orders_status_allowed` CHECK in migration 014; adding a state means a
 * migration and a value here, in that order.
 */
export const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
});

/**
 * Payment states. They mirror the `orders_payment_status_allowed` and
 * `payments_status_allowed` CHECKs (migration 014/016). FAILED and REFUNDED
 * exist for providers that arrive later; the COD flow only reaches PENDING
 * here and PAID when the courier collects.
 */
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

/**
 * Payment methods. Only COD is real in this phase; ONLINE is reserved so the
 * order and payment rows already carry the distinction a provider integration
 * will need.
 */
export const PAYMENT_METHOD = Object.freeze({
  COD: 'COD',
  ONLINE: 'ONLINE',
});

/**
 * Payment providers written onto a `payments` row. `provider` is a free-form
 * VARCHAR in the schema, so a new integration needs no migration — it only
 * needs a constant here and an adapter in `src/payments/`.
 *
 * INTERNAL is the store itself (cash on delivery). MOCK is the sandbox online
 * provider that stands in for a real gateway until credentials exist; the other
 * names are reserved so configuration can name a real provider without a code
 * change first.
 */
export const PAYMENT_PROVIDER = Object.freeze({
  INTERNAL: 'INTERNAL',
  MOCK: 'MOCK',
  TELEBIRR: 'TELEBIRR',
  STRIPE: 'STRIPE',
  PAYSTACK: 'PAYSTACK',
});

/**
 * The subset of provider names that can drive an ONLINE payment. INTERNAL
 * (cash on delivery) is deliberately absent: it is a fulfilment method, not an
 * online gateway, and never receives a signed notification.
 */
export const ONLINE_PAYMENT_PROVIDERS = Object.freeze([
  PAYMENT_PROVIDER.MOCK,
  PAYMENT_PROVIDER.TELEBIRR,
  PAYMENT_PROVIDER.STRIPE,
  PAYMENT_PROVIDER.PAYSTACK,
]);

/**
 * Delivery configuration.
 *
 * Delivery rules are not finalised, so this is deliberately shallow: one flat
 * fee, waived at or above a threshold, with an ordered list of `ZONES` that a
 * future per-area tariff can populate without touching the order service. A
 * zone matches on a lower-cased city (and, optionally, area); the first match
 * wins and the fallback zone is always the default one. Adding a real zone is a
 * data change here, not a redesign.
 *
 * Money is ETB minor units, keeping the whole stack on integers.
 */
export const DELIVERY = Object.freeze({
  DEFAULT_FEE_MINOR: 50_000,
  /** Keep in step with `frontend/js/config.js` `freeShippingThreshold`. */
  FREE_THRESHOLD_MINOR: 500_000,
  MAX_FEE_MINOR: 100_000_000,
  /** Estimated delivery window, in days, for the default (fallback) zone. */
  DEFAULT_ETA_MIN_DAYS: 2,
  DEFAULT_ETA_MAX_DAYS: 5,
  MAX_ETA_DAYS: 60,
  ZONES: Object.freeze([
    // Placeholder shape for future zones. `city: null` matches everything.
    // A zone may also carry an ETA window and an `available` flag so a
    // destination the store cannot reach is refused, not silently mispriced.
    // {
    //   name: 'Addis Ababa',
    //   city: 'addis ababa',
    //   feeMinor: 50_000,
    //   freeThresholdMinor: 500_000,
    //   etaMinDays: 1,
    //   etaMaxDays: 2,
    //   available: true,
    // },
  ]),
});

/**
 * Order-number format: `ORD-<YYYYMMDD>-<NNNN>` (see migration 014). Bounded so
 * it cannot outgrow the `orders.order_number VARCHAR(32)` column.
 */
export const ORDER_NUMBER = Object.freeze({
  PREFIX: 'ORD',
  SEQUENCE_PAD: 4,
  /** Highest sequence accepted before the day's numbering needs a wider pad. */
  MAX_SEQUENCE: 9999,
});

/** Bounds on checkout input that must not reach the database unchecked. */
export const CHECKOUT_LIMITS = Object.freeze({
  MAX_NOTES: 1000,
  MAX_LINES: CART_LIMITS.MAX_LINES,
});

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
  /** An order whose method is COD cannot start an online payment. */
  PAYMENT_NOT_REQUIRED: 'PAYMENT_NOT_REQUIRED',
  /** The destination is outside the store's configured delivery areas. */
  DELIVERY_UNAVAILABLE: 'DELIVERY_UNAVAILABLE',
  /** An order status change that the fulfilment lifecycle does not allow. */
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  /** A review submitted for an item the customer did not buy (or not yet delivered). */
  REVIEW_NOT_ELIGIBLE: 'REVIEW_NOT_ELIGIBLE',
  /** This customer (or this purchase line) has already been reviewed. */
  REVIEW_ALREADY_SUBMITTED: 'REVIEW_ALREADY_SUBMITTED',
  /** A coupon that does not exist, is inactive, is out of window, or its limits are exhausted. */
  COUPON_INVALID: 'COUPON_INVALID',
});

/** Default and maximum page sizes for list endpoints. */
export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
});

/* -------------------------------------------------------------------------- */
/* Store management (Phase 10)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Catalogue visibility of a product, matching the `products_status_allowed`
 * CHECK (migration 005). DRAFT is invisible, ACTIVE is sellable, ARCHIVED is
 * hidden but kept because order history still points at it.
 */
export const PRODUCT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
});

/** Purchasable unit type, matching `products_type_allowed` (migration 005). */
export const PRODUCT_TYPE = Object.freeze({
  PHYSICAL: 'PHYSICAL',
  DIGITAL: 'DIGITAL',
});

/** Account lifecycle an admin may set, matching `users_status_allowed` (migration 002). */
export const CUSTOMER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'INACTIVE',
});

/** Review moderation states, matching `reviews_status_allowed` (migration 017). */
export const REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

/**
 * Stock-ledger movement types, matching `inventory_transactions_type_allowed`
 * (migration 009). SALE is written by the checkout flow only; an administrator
 * may write RESTOCK, RETURN, DAMAGE and ADJUSTMENT.
 */
export const INVENTORY_TRANSACTION_TYPE = Object.freeze({
  RESTOCK: 'RESTOCK',
  SALE: 'SALE',
  RETURN: 'RETURN',
  DAMAGE: 'DAMAGE',
  ADJUSTMENT: 'ADJUSTMENT',
});

/** The movement types an admin `adjust` call may request (SALE excluded). */
export const ADMIN_ADJUSTMENT_TYPES = Object.freeze([
  INVENTORY_TRANSACTION_TYPE.RESTOCK,
  INVENTORY_TRANSACTION_TYPE.RETURN,
  INVENTORY_TRANSACTION_TYPE.DAMAGE,
  INVENTORY_TRANSACTION_TYPE.ADJUSTMENT,
]);

/**
 * How a coupon's value is interpreted, matching `coupons_type_allowed`
 * (migration 023). PERCENT is a whole-number percentage (1-100); FIXED is an
 * amount in ETB minor units.
 */
export const COUPON_TYPE = Object.freeze({
  PERCENT: 'PERCENT',
  FIXED: 'FIXED',
});

/**
 * The movements an order status may make.
 *
 * Fulfilment is a one-way street with one escape hatch: an order advances
 * PENDING -> CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED, and may be
 * cancelled at any point before it ships. It may not jump from PENDING straight
 * to DELIVERED, and a CANCELLED or DELIVERED order is terminal. Encoding the
 * graph here - rather than as a checklist in a controller - is what lets the
 * service refuse an arbitrary jump with one clear rule.
 */
export const ORDER_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze([ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED]),
  CONFIRMED: Object.freeze([ORDER_STATUS.PROCESSING, ORDER_STATUS.CANCELLED]),
  PROCESSING: Object.freeze([ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED]),
  SHIPPED: Object.freeze([ORDER_STATUS.DELIVERED]),
  DELIVERED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

/** Administrative actions recorded in `audit_logs`. */
export const AUDIT_ACTION = Object.freeze({
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_ARCHIVED: 'PRODUCT_ARCHIVED',
  VARIANT_CREATED: 'VARIANT_CREATED',
  VARIANT_UPDATED: 'VARIANT_UPDATED',
  VARIANT_DEACTIVATED: 'VARIANT_DEACTIVATED',
  IMAGE_ADDED: 'IMAGE_ADDED',
  IMAGE_UPDATED: 'IMAGE_UPDATED',
  IMAGE_REMOVED: 'IMAGE_REMOVED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  CATEGORY_ARCHIVED: 'CATEGORY_ARCHIVED',
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  INVENTORY_REORDER_LEVEL_UPDATED: 'INVENTORY_REORDER_LEVEL_UPDATED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  CUSTOMER_STATUS_CHANGED: 'CUSTOMER_STATUS_CHANGED',
  REVIEW_MODERATED: 'REVIEW_MODERATED',
  COUPON_CREATED: 'COUPON_CREATED',
  COUPON_UPDATED: 'COUPON_UPDATED',
  COUPON_DEACTIVATED: 'COUPON_DEACTIVATED',
  COUPON_ACTIVATED: 'COUPON_ACTIVATED',
});

/** Entity kinds an audit row can point at. */
export const AUDIT_ENTITY = Object.freeze({
  PRODUCT: 'PRODUCT',
  VARIANT: 'VARIANT',
  IMAGE: 'IMAGE',
  CATEGORY: 'CATEGORY',
  INVENTORY: 'INVENTORY',
  ORDER: 'ORDER',
  CUSTOMER: 'CUSTOMER',
  REVIEW: 'REVIEW',
  COUPON: 'COUPON',
});

/** Bounds on store-management writes that must not reach the database unchecked. */
export const ADMIN_LIMITS = Object.freeze({
  MAX_ATTRIBUTES: 30,
  MAX_ATTRIBUTE_KEY: 40,
  MAX_ATTRIBUTE_VALUE: 80,
  MAX_BULK_VARIANTS: 100,
  /** Largest single stock correction or restock, in units. */
  MAX_STOCK_DELTA: 1_000_000,
  /** Coupon code and description lengths, matching the 023 columns. */
  MAX_COUPON_CODE: 40,
  MAX_COUPON_DESCRIPTION: 255,
  /** Largest fixed discount or PERCENT cap, in ETB minor units. */
  MAX_COUPON_VALUE_MINOR: 100_000_000,
});
