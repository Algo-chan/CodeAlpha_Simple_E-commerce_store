-- 015_create_order_items.sql
-- What was actually bought, captured at purchase time.
--
-- Snapshots, not references
--   product_name, sku, variant_attributes, unit_price and subtotal are copies.
--   Raise the price of "Nike Air Max 270" from 3700 ETB to 4200 ETB tomorrow
--   and last month's order still reads 3700 ETB, because this row kept its own
--   copy. The foreign keys are kept purely to stop the product and variant from
--   being hard-deleted while they are referenced by history - the display
--   values never come from those tables.
--
--   sub_totals are verified: subtotal = unit_price * quantity.
--
-- Why variant_id is nullable
--   A DIGITAL product may be sold without any variant row, so the line only
--   stores product_id. Physical lines always carry a variant_id.
--   "A NULL variant_id belongs to a DIGITAL product" cannot be a CHECK
--   constraint (it would need a subquery on products); the checkout service
--   enforces it, and an audit query can verify it at any time:
--     SELECT * FROM order_items oi JOIN products p ON p.id = oi.product_id
--     WHERE oi.variant_id IS NULL AND p.product_type <> 'DIGITAL';
--
--   SKU is filled in even for a digital product that has no variant row, when
--   one exists to fill it in, so order search by SKU still works.
--
-- ON DELETE RESTRICT on both references: a product that has been ordered is
-- archived (products.status = 'ARCHIVED'), never deleted.

CREATE TABLE IF NOT EXISTS order_items (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID         NOT NULL,
  product_id         UUID         NOT NULL,
  variant_id         UUID,
  product_name       VARCHAR(200) NOT NULL,
  sku                VARCHAR(64),
  variant_attributes JSONB        NOT NULL DEFAULT '{}'::JSONB,
  unit_price         BIGINT       NOT NULL,
  quantity           INTEGER      NOT NULL,
  subtotal           BIGINT       NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT order_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE RESTRICT,
  CONSTRAINT order_items_product_name_required CHECK (BTRIM(product_name) <> ''),
  CONSTRAINT order_items_attributes_is_object CHECK (
    JSONB_TYPEOF(variant_attributes) = 'object'
  ),
  CONSTRAINT order_items_unit_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_subtotal_non_negative CHECK (subtotal >= 0),
  CONSTRAINT order_items_subtotal_is_derived CHECK (subtotal = unit_price * quantity)
);

COMMENT ON TABLE order_items IS
  'Purchased line with an immutable purchase-time snapshot of name, SKU, options and price.';
COMMENT ON COLUMN order_items.unit_price IS
  'Price per unit in minor units (ETB cents) at the moment of purchase.';
COMMENT ON COLUMN order_items.variant_attributes IS
  'Copy of product_variants.attributes at purchase time, e.g. {"color":"Black","size":"42"}.';
COMMENT ON COLUMN order_items.variant_id IS
  'NULL only for digital products sold without a variant row.';

-- Reading the lines of an order.
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
-- "Every time this product was bought" and the sales-by-product report.
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items (variant_id);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS order_items;
