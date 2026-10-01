-- 013_create_wishlist_items.sql
-- Wishlist entries reference the PRODUCT, not a variant.
--
-- A customer saves "the shoes" first and picks size/colour later, so pinning a
-- variant would be the wrong model. The unique constraint is what stops the
-- same product being saved twice.

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id UUID        NOT NULL,
  product_id  UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT wishlist_items_wishlist_id_fkey
    FOREIGN KEY (wishlist_id) REFERENCES wishlists (id) ON DELETE CASCADE,
  CONSTRAINT wishlist_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT wishlist_items_unique_product UNIQUE (wishlist_id, product_id)
);

COMMENT ON TABLE wishlist_items IS
  'Saved products, one row per product per wishlist. Variants are chosen at add-to-cart time.';

CREATE INDEX IF NOT EXISTS idx_wishlist_items_product_id ON wishlist_items (product_id);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS wishlist_items;
