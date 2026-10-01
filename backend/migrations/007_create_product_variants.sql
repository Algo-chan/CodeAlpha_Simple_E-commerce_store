-- 007_create_product_variants.sql
-- The purchasable unit of a product: "Nike Air Max 270 / Black / 42".
--
-- Money
--   `price` is stored in minor units (ETB cents) as BIGINT. 3700.00 ETB is
--   370000. Floating point is never used for money. `currency` on orders and
--   payments records which currency the amounts are denominated in; a single
--   store trades in ETB, so it is not repeated on every price column.
--
-- Attributes
--   `attributes` is JSONB, not a set of colour/size/storage columns, so each
--   product family defines its own options: {"color":"Black","size":"42"} for
--   footwear, {"storage":"256GB","ram":"8GB"} for phones, {} for a product that
--   needs no options. The CHECK guarantees the value is a JSON object.

CREATE TABLE IF NOT EXISTS product_variants (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID         NOT NULL,
  sku                VARCHAR(64)  NOT NULL,
  price              BIGINT       NOT NULL,
  compare_at_price   BIGINT,
  attributes         JSONB        NOT NULL DEFAULT '{}'::JSONB,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT product_variants_sku_unique UNIQUE (sku),
  CONSTRAINT product_variants_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT product_variants_price_non_negative CHECK (price >= 0),
  CONSTRAINT product_variants_price_sane CHECK (price <= 1000000000000),
  CONSTRAINT product_variants_compare_at_price_positive CHECK (
    compare_at_price IS NULL OR compare_at_price > 0
  ),
  -- "compare_at_price" is a "was" price, so it must always be higher than the
  -- price actually charged. A price rise therefore has to withdraw the
  -- promotion in the same update (SET price = ..., compare_at_price = NULL);
  -- the admin service is responsible for doing both together. The alternative -
  -- allowing compare_at_price < price - would let the storefront render a
  -- discount that is really a mark-up.
  CONSTRAINT product_variants_compare_at_price_above_price CHECK (
    compare_at_price IS NULL OR compare_at_price > price
  ),
  CONSTRAINT product_variants_attributes_is_object CHECK (
    JSONB_TYPEOF(attributes) = 'object'
  )
);

COMMENT ON TABLE product_variants IS
  'Purchasable configuration of a product. Price in minor units (ETB cents).';
COMMENT ON COLUMN product_variants.price IS
  'Selling price in minor units (ETB cents), e.g. 370000 = 3,700.00 ETB.';
COMMENT ON COLUMN product_variants.compare_at_price IS
  'Optional "was" price, in minor units. Must be greater than price when set, so raising the price above it requires clearing this column in the same update.';
COMMENT ON COLUMN product_variants.attributes IS
  'Flexible option values as a JSON object, e.g. {"color":"Black","size":"42"}.';

-- Variant list of one product.
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id
  ON product_variants (product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_is_active
  ON product_variants (is_active);

-- Supports filtering a category by option ("only 256GB, 8GB") without
-- hard-coding attribute columns. Not used by the bare CRUD reads above.
CREATE INDEX IF NOT EXISTS idx_product_variants_attributes
  ON product_variants USING GIN (attributes jsonb_path_ops);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS product_variants;
