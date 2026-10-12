-- 023_create_coupons.sql
-- Discount codes that a checkout may redeem, and the link from an order back to
-- the code that was used.
--
-- WHY discount_total ALREADY EXISTS
--   014 reserved `orders.discount_total` (NOT NULL DEFAULT 0, 0 <= it <= subtotal)
--   precisely so coupons could be added later without reshaping the money
--   columns. This migration fills that slot: it does not add a second discount
--   column and it does not change how a total is derived.
--
-- MONEY AND UNITS
--   `discount_value` means one of two things, decided by `discount_type`:
--     PERCENT  a whole-number percentage, 1..100
--     FIXED    an amount in ETB minor units (cents), > 0
--   Both are BIGINT so neither can be a float. A PERCENT code may cap its award
--   with `max_discount` (also minor units); a FIXED code must not exceed the
--   subtotal itself, which the checkout service clamps at redemption time.
--
-- USAGE
--   `max_uses` is a lifetime cap shared by everyone (NULL = unlimited);
--   `used_count` is incremented exactly once per successful order inside the
--   same transaction, under a row lock, so two concurrent checkouts cannot both
--   spend the last use. `per_user_limit` is a cap per signed-in customer and is
--   counted from prior orders that carry this coupon id.
--
-- HISTORY
--   An order snapshots `coupon_code` alongside `coupon_id`. The id is the real
--   link (ON DELETE SET NULL keeps history if a coupon is ever removed), and the
--   code text is what the receipt shows even after the coupon is deleted.

CREATE TABLE IF NOT EXISTS coupons (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(40)  NOT NULL,
  description    VARCHAR(255),
  discount_type  VARCHAR(10)  NOT NULL,
  discount_value BIGINT       NOT NULL,
  min_subtotal   BIGINT       NOT NULL DEFAULT 0,
  max_discount   BIGINT,
  valid_from     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  valid_until    TIMESTAMPTZ,
  max_uses       BIGINT,
  used_count     BIGINT       NOT NULL DEFAULT 0,
  per_user_limit INTEGER,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT coupons_code_unique UNIQUE (code),
  -- Codes are stored exactly as typed in upper case with no internal spaces, so
  -- lookups can be exact rather than case-insensitive every time.
  CONSTRAINT coupons_code_format CHECK (
    code = UPPER(BTRIM(code)) AND POSITION(' ' IN code) = 0 AND BTRIM(code) <> ''
  ),
  CONSTRAINT coupons_type_allowed CHECK (discount_type IN ('PERCENT', 'FIXED')),
  CONSTRAINT coupons_percent_value CHECK (
    discount_type <> 'PERCENT' OR discount_value BETWEEN 1 AND 100
  ),
  CONSTRAINT coupons_fixed_value CHECK (
    discount_type <> 'FIXED' OR discount_value > 0
  ),
  CONSTRAINT coupons_min_subtotal_non_negative CHECK (min_subtotal >= 0),
  CONSTRAINT coupons_max_discount_positive CHECK (max_discount IS NULL OR max_discount > 0),
  CONSTRAINT coupons_used_count_non_negative CHECK (used_count >= 0),
  CONSTRAINT coupons_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT coupons_per_user_positive CHECK (per_user_limit IS NULL OR per_user_limit > 0),
  CONSTRAINT coupons_window_valid CHECK (valid_until IS NULL OR valid_until >= valid_from),
  -- A PERCENT cap only makes sense on a percentage code.
  CONSTRAINT coupons_max_discount_only_percent CHECK (
    max_discount IS NULL OR discount_type = 'PERCENT'
  )
);

COMMENT ON TABLE coupons IS
  'Redeemable discount codes. Money and limits are enforced in minor units; usage is counted in the checkout transaction.';
COMMENT ON COLUMN coupons.code IS
  'The code a shopper types, stored upper-cased and space-free so lookup is exact.';
COMMENT ON COLUMN coupons.discount_value IS
  'PERCENT: a whole-number percentage (1-100). FIXED: an amount in ETB minor units.';
COMMENT ON COLUMN coupons.max_discount IS
  'PERCENT only: the largest award in minor units. NULL means uncapped.';
COMMENT ON COLUMN coupons.used_count IS
  'Lifetime redemptions. Incremented once per order inside the checkout transaction.';

CREATE INDEX IF NOT EXISTS idx_coupons_active_window
  ON coupons (is_active, valid_until);

-- The updated_at trigger. 018 registered every table that existed then; a new
-- table has to add its own.
CREATE TRIGGER coupons_set_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The order's link back to the code that was redeemed. The id drives reporting;
-- the code snapshot is what survives a deleted coupon.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_coupon_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_coupon_id_fkey
        FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN orders.coupon_id IS
  'The coupon redeemed on this order, or NULL. SET NULL keeps history if a coupon is removed.';
COMMENT ON COLUMN orders.coupon_code IS
  'Snapshot of the redeemed code, shown on the receipt even after the coupon is edited or deleted.';

CREATE INDEX IF NOT EXISTS idx_orders_coupon_id ON orders (coupon_id);

-- ROLLBACK (down)
-- DROP INDEX IF EXISTS idx_orders_coupon_id;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_coupon_id_fkey;
-- ALTER TABLE orders DROP COLUMN IF EXISTS coupon_id;
-- ALTER TABLE orders DROP COLUMN IF EXISTS coupon_code;
-- DROP TRIGGER IF EXISTS coupons_set_updated_at ON coupons;
-- DROP TABLE IF EXISTS coupons;
