-- 012_create_wishlists.sql
-- A saved-products list owned by a customer. One wishlist per user in v1;
-- uniqueness on user_id keeps that rule in the database rather than in a
-- controller, and named secondary wishlists can be added later by relaxing it.

CREATE TABLE IF NOT EXISTS wishlists (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL,
  name       VARCHAR(80)  NOT NULL DEFAULT 'My Wishlist',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT wishlists_user_id_unique UNIQUE (user_id),
  CONSTRAINT wishlists_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT wishlists_name_required CHECK (BTRIM(name) <> '')
);

COMMENT ON TABLE wishlists IS
  'Saved products per customer. One wishlist per user in v1.';

-- user_id is already unique, so no extra index is required.

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS wishlists;
