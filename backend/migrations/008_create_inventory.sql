-- 008_create_inventory.sql
-- Stock per product variant ("Black / 42 has 0 left").
--
-- The variant id is both primary and foreign key, so this is a strict 1:1
-- extension of a variant. A row is optional: a DIGITAL product needs no stock
-- record at all, and that absence is the signal.
--
--   quantity            on hand
--   reserved_quantity   held for orders that are not yet shipped
--   available           = quantity - reserved_quantity  (computed by the service)
--
-- Check constraints keep stock non-negative and never over-reserved, so a
-- concurrency bug cannot write an impossible quantity.

CREATE TABLE IF NOT EXISTS inventory (
  variant_id        UUID        PRIMARY KEY,
  quantity          INTEGER     NOT NULL DEFAULT 0,
  reserved_quantity INTEGER     NOT NULL DEFAULT 0,
  reorder_level     INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT inventory_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE CASCADE,
  CONSTRAINT inventory_quantity_non_negative CHECK (quantity >= 0),
  CONSTRAINT inventory_reserved_non_negative CHECK (reserved_quantity >= 0),
  CONSTRAINT inventory_reserved_within_quantity CHECK (reserved_quantity <= quantity),
  CONSTRAINT inventory_reorder_level_non_negative CHECK (reorder_level >= 0)
);

COMMENT ON TABLE inventory IS
  'Stock per variant. A missing row means "not stock-tracked" (used by DIGITAL products).';
COMMENT ON COLUMN inventory.reserved_quantity IS
  'Units held for in-flight orders. Must never exceed quantity.';

-- No extra index needed: variant_id is the primary key, and the low-stock
-- report is an admin-time scan of a small table.

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS inventory;
