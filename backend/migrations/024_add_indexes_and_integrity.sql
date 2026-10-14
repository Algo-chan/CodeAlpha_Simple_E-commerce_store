-- 024_add_indexes_and_integrity.sql
-- Phase 11 hardening: indexes that the query workload depends on, plus one
-- integrity rule the schema was missing. Nothing here changes application
-- behaviour; every statement is idempotent so re-running is a no-op.
--
-- WHY EACH INDEX EXISTS
--
--   products (created_at DESC) WHERE status = 'ACTIVE'
--     The storefront's default sort is "featured", which is
--     ORDER BY created_at DESC over active products. 005 indexed status and
--     (status, category_id) but never created_at, so the home page and an
--     unfiltered collection page sorted a full table scan. Partial on ACTIVE
--     because the listing predicate always carries `status = 'ACTIVE'`; the
--     planner can match the predicate and use the index for the sort.
--
--   reviews (moderated_by) WHERE moderated_by IS NOT NULL
--   inventory_transactions (created_by) WHERE created_by IS NOT NULL
--   carts (merged_into_cart_id) WHERE merged_into_cart_id IS NOT NULL
--     Referencing a parent on DELETE SET NULL without an index on the child
--     column forces PostgreSQL to scan the whole child table to find the rows.
--     These are the only foreign keys in the schema that lacked one. Partial
--     because NULL is the common case and never needs to be looked up.
--
-- THE MISSING RULE
--
--   coupons.used_count <= max_uses
--     The redemption path already refuses to spend the last use (it checks
--     `used_count < max_uses` under a row lock), but nothing in the schema made
--     "used more times than allowed" impossible. An admin lowering max_uses
--     below the current count could leave a row that claims more redemptions
--     than the cap allows. The CHECK makes that state unrepresentable.
--
-- ROLLBACK (down)
-- DROP INDEX IF EXISTS idx_products_active_created_at;
-- DROP INDEX IF EXISTS idx_reviews_moderated_by;
-- DROP INDEX IF EXISTS idx_inventory_transactions_created_by;
-- DROP INDEX IF EXISTS idx_carts_merged_into_cart_id;
-- ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_used_within_max;

-- Default storefront listing: active products, newest first.
CREATE INDEX IF NOT EXISTS idx_products_active_created_at
  ON products (created_at DESC)
  WHERE status = 'ACTIVE';

-- Foreign-key support for ON DELETE SET NULL / RESTRICT paths.
CREATE INDEX IF NOT EXISTS idx_reviews_moderated_by
  ON reviews (moderated_by) WHERE moderated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_by
  ON inventory_transactions (created_by) WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_carts_merged_into_cart_id
  ON carts (merged_into_cart_id) WHERE merged_into_cart_id IS NOT NULL;

-- A coupon can never have been used more times than its own cap allows.
-- NULL max_uses means unlimited, so the rule is vacuous there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_used_within_max'
  ) THEN
    ALTER TABLE coupons
      ADD CONSTRAINT coupons_used_within_max
        CHECK (max_uses IS NULL OR used_count <= max_uses);
  END IF;
END $$;

COMMENT ON CONSTRAINT coupons_used_within_max ON coupons IS
  'Redemptions can never exceed the coupon''s own lifetime cap.';
