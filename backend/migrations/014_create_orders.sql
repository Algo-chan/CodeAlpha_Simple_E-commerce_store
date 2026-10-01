-- 014_create_orders.sql
-- A placed purchase. Money is in minor units (ETB cents) as BIGINT, never float.
--
-- Guest checkout
--   user_id is NULL for a guest order. The contact details needed to fulfil it
--   are copied onto the order itself (customer_email, customer_phone,
--   shipping_address_snapshot) so the order stays fulfilable even if the
--   account behind it is deleted later.
--
-- Shipping address snapshot
--   shipping_address_snapshot is a JSONB copy of the address used at checkout.
--   It is immutable history: editing addresses.user_id's address, or deleting
--   the account, must not change what was shipped or where. The snapshot shape
--   mirrors the addresses table:
--     { "full_name", "phone", "city", "area", "street", "landmark",
--       "additional_notes", "label" }
--
-- Totals
--   total = subtotal + delivery_fee - discount_total. discount_total exists so
--   coupons and promotions can be added later without changing the shape of
--   every financial column; it is 0 in v1 and never negative.
--   Tax is intentionally absent: no tax rule is decided yet, and adding
--   tax_total later is additive.

CREATE TABLE IF NOT EXISTS orders (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number            VARCHAR(32)  NOT NULL,
  user_id                 UUID,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  subtotal                BIGINT       NOT NULL,
  delivery_fee            BIGINT       NOT NULL DEFAULT 0,
  discount_total          BIGINT       NOT NULL DEFAULT 0,
  total                   BIGINT       NOT NULL,
  currency                CHAR(3)      NOT NULL DEFAULT 'ETB',
  payment_status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  payment_method          VARCHAR(20)  NOT NULL DEFAULT 'COD',
  customer_email          VARCHAR(255) NOT NULL,
  customer_phone          VARCHAR(20)  NOT NULL,
  shipping_address_snapshot JSONB      NOT NULL,
  customer_notes          TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT orders_order_number_unique UNIQUE (order_number),
  CONSTRAINT orders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT orders_status_allowed CHECK (
    status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')
  ),
  CONSTRAINT orders_payment_status_allowed CHECK (
    payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')
  ),
  CONSTRAINT orders_payment_method_allowed CHECK (
    payment_method IN ('COD', 'ONLINE')
  ),
  CONSTRAINT orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT orders_subtotal_non_negative CHECK (subtotal >= 0),
  CONSTRAINT orders_delivery_fee_non_negative CHECK (delivery_fee >= 0),
  CONSTRAINT orders_discount_non_negative CHECK (discount_total >= 0),
  CONSTRAINT orders_discount_not_above_subtotal CHECK (discount_total <= subtotal),
  CONSTRAINT orders_total_non_negative CHECK (total >= 0),
  CONSTRAINT orders_total_is_derived CHECK (
    total = subtotal + delivery_fee - discount_total
  ),
  CONSTRAINT orders_customer_email_format CHECK (
    customer_email = LOWER(BTRIM(customer_email))
    AND POSITION('@' IN customer_email) > 1
  ),
  CONSTRAINT orders_customer_phone_format CHECK (
    customer_phone ~ '^\+?[0-9]{9,15}$'
  ),
  CONSTRAINT orders_shipping_snapshot_is_object CHECK (
    JSONB_TYPEOF(shipping_address_snapshot) = 'object'
  ),
  CONSTRAINT orders_shipping_snapshot_has_name CHECK (
    COALESCE(shipping_address_snapshot ->> 'full_name', '') <> ''
  ),
  CONSTRAINT orders_shipping_snapshot_has_city CHECK (
    COALESCE(shipping_address_snapshot ->> 'city', '') <> ''
  )
);

COMMENT ON TABLE orders IS
  'Placed purchases, including guest orders (user_id NULL). Money in ETB cents.';
COMMENT ON COLUMN orders.order_number IS
  'Human-readable reference shown to the customer, e.g. ORD-20260115-0001. Unique.';
COMMENT ON COLUMN orders.user_id IS
  'NULL for guest checkout. Set to NULL (not deleted) if the account is removed.';
COMMENT ON COLUMN orders.status IS
  'Fulfilment lifecycle: PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED or CANCELLED.';
COMMENT ON COLUMN orders.payment_status IS
  'Mirrors the latest payments row: PENDING, PAID, FAILED or REFUNDED.';
COMMENT ON COLUMN orders.payment_method IS
  'COD (cash on delivery) or ONLINE. Provider detail lives in payments.';
COMMENT ON COLUMN orders.discount_total IS
  'Always 0 in v1; reserved so coupons can be added without reshaping money columns.';
COMMENT ON COLUMN orders.shipping_address_snapshot IS
  'Immutable copy of the delivery address as it was at checkout.';
COMMENT ON COLUMN orders.customer_email IS
  'Order-level fulfilment contact. A snapshot, so it survives account deletion.';

-- Order history of one customer, newest first.
CREATE INDEX IF NOT EXISTS idx_orders_user_id
  ON orders (user_id, created_at DESC);
-- Fulfilment queue and admin order lists.
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);
-- Reporting and the newest-orders block.
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
-- "Find the order for this email" - guest lookups and support.
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders (customer_email);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS orders;
