-- 011_create_cart_items.sql
-- Lines of a cart. Every line points at a product VARIANT, because "Black / 42"
-- is the thing that is bought, shipped and stocked.
--
-- Deliberately absent: price. A cart line stores a quantity only, so the
-- cart API must read the live product_variants.price when it returns totals.
-- A stale price in the cart would silently become the price paid.
--
-- product_id is not stored either: it is reachable through
-- product_variants.product_id, and duplicating it here would create a second
-- source of truth that could disagree with the variant's real product.

CREATE TABLE IF NOT EXISTS cart_items (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    UUID        NOT NULL,
  variant_id UUID        NOT NULL,
  quantity   INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cart_items_cart_id_fkey
    FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT cart_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE CASCADE,
  CONSTRAINT cart_items_unique_variant_per_cart UNIQUE (cart_id, variant_id),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT cart_items_quantity_sane CHECK (quantity <= 100)
);

COMMENT ON TABLE cart_items IS
  'Cart lines. Quantity only: price always comes from the live variant.';

-- Reading a cart is by cart_id (covered by the unique constraint above);
-- this index serves "which carts hold this variant" during cleanup.
CREATE INDEX IF NOT EXISTS idx_cart_items_variant_id ON cart_items (variant_id);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS cart_items;
