-- 001_create_shared_helpers.sql
-- Shared database helpers used by every other migration.
--
-- set_updated_at() is attached as a BEFORE UPDATE trigger in
-- 018_create_updated_at_triggers.sql, once every table exists.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'BEFORE UPDATE trigger that keeps updated_at current. Attached to every mutable table.';

-- ROLLBACK (down)
-- DROP FUNCTION IF EXISTS set_updated_at();
