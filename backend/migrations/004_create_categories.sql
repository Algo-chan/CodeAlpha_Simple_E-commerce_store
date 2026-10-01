-- 004_create_categories.sql
-- Self-referencing category tree (Electronics > Phones > Smartphones).
--
-- ON DELETE RESTRICT on parent_id: a category that still has children cannot be
-- deleted, so the tree can never be silently orphaned. Re-parent or remove the
-- children first.

CREATE TABLE IF NOT EXISTS categories (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(140) NOT NULL,
  description TEXT,
  image_url   TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT categories_slug_unique UNIQUE (slug),
  CONSTRAINT categories_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT categories_name_required CHECK (BTRIM(name) <> ''),
  CONSTRAINT categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT categories_sort_order_positive CHECK (sort_order >= 0)
);

COMMENT ON TABLE categories IS
  'Product category tree. parent_id NULL means top level; ON DELETE RESTRICT protects children.';
COMMENT ON COLUMN categories.sort_order IS
  'Manual ordering within the parent; lower sorts first.';

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_is_active ON categories (is_active);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS categories;
