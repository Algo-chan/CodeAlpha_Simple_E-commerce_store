-- 005_create_products.sql
-- The general item being sold (for example "Nike Air Max 270").
--
-- A product carries identity and copy only. It deliberately has NO price and NO
-- stock column: both belong to the purchasable unit, the product variant
-- (007_create_product_variants.sql), so "Black / 42" can be priced and stocked
-- independently of "White / 42".
--
-- category_id is nullable so a draft can be created before it is filed.

CREATE TABLE IF NOT EXISTS products (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID,
  name         VARCHAR(200)  NOT NULL,
  slug         VARCHAR(220)  NOT NULL,
  description  TEXT,
  product_type VARCHAR(20)   NOT NULL DEFAULT 'PHYSICAL',
  brand        VARCHAR(80),
  status       VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT products_slug_unique UNIQUE (slug),
  CONSTRAINT products_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT products_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT products_name_required CHECK (BTRIM(name) <> ''),
  CONSTRAINT products_type_allowed CHECK (product_type IN ('PHYSICAL', 'DIGITAL')),
  CONSTRAINT products_status_allowed CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
);

COMMENT ON TABLE products IS
  'Sellable item identity and copy. Price and stock live on product_variants, never here.';
COMMENT ON COLUMN products.product_type IS
  'PHYSICAL items are stocked and shipped; DIGITAL items are delivered as a download.';
COMMENT ON COLUMN products.status IS
  'DRAFT (not visible), ACTIVE (sellable) or ARCHIVED (hidden, kept for order history).';

-- Serves the storefront listing: active products of one type inside a category.
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products (product_type);
CREATE INDEX IF NOT EXISTS idx_products_status_category_id
  ON products (status, category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS products;
