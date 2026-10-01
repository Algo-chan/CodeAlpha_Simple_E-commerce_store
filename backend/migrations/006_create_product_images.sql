-- 006_create_product_images.sql
-- Any number of images per product (front, side, back, detail, lifestyle...).
--
-- There is no maximum: the count is bounded by the gallery the frontend renders.
-- sort_order + is_primary are what the gallery, thumbnails, zoom and
-- hover-swap interactions read; exactly one image per product may be primary,
-- enforced by a partial unique index.

CREATE TABLE IF NOT EXISTS product_images (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID         NOT NULL,
  image_url  TEXT         NOT NULL,
  alt_text   VARCHAR(255),
  sort_order INTEGER      NOT NULL DEFAULT 0,
  is_primary BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT product_images_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT product_images_url_required CHECK (BTRIM(image_url) <> ''),
  CONSTRAINT product_images_sort_order_positive CHECK (sort_order >= 0)
);

COMMENT ON TABLE product_images IS
  'Ordered product gallery. At most one row per product may be is_primary.';

-- Gallery read order for one product.
CREATE INDEX IF NOT EXISTS idx_product_images_product_id
  ON product_images (product_id, sort_order);

-- At most one primary image per product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_single_primary
  ON product_images (product_id) WHERE is_primary;

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS product_images;
