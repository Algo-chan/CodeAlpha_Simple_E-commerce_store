-- 003_create_addresses.sql
-- Delivery addresses for customers (Ethiopian / local delivery fields).
--
-- v1 uses one address per customer, but the table is not built around that
-- limit: is_default plus a partial unique index guarantee "one default per
-- user" while allowing additional named addresses later without a redesign.
--
-- This table is NOT the source of truth for a placed order. Orders store their
-- own immutable snapshot in orders.shipping_address_snapshot, so editing an
-- address here never rewrites order history.

CREATE TABLE IF NOT EXISTS addresses (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL,
  label            VARCHAR(60)  NOT NULL DEFAULT 'Default',
  full_name        VARCHAR(120) NOT NULL,
  phone            VARCHAR(20)  NOT NULL,
  city             VARCHAR(80)  NOT NULL,
  area             VARCHAR(80)  NOT NULL,
  street           VARCHAR(160) NOT NULL,
  landmark         VARCHAR(160),
  additional_notes TEXT,
  is_default       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT addresses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT addresses_phone_format CHECK (phone ~ '^\+?[0-9]{9,15}$'),
  CONSTRAINT addresses_street_required CHECK (BTRIM(street) <> ''),
  CONSTRAINT addresses_area_required CHECK (BTRIM(area) <> '')
);

COMMENT ON TABLE addresses IS
  'Customer delivery addresses. Orders keep their own snapshot; this table is only the editable current address.';
COMMENT ON COLUMN addresses.area IS
  'Sub-city / district / town (for example Bole, Kirkos, Adama).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_default_per_user
  ON addresses (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses (user_id, created_at);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS addresses;
