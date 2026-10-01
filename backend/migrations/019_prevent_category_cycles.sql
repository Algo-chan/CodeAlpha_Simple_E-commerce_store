-- 019_prevent_category_cycles.sql
--
-- A trigger that closes the loop on the category tree.
--
-- 004 already has `categories_not_own_parent`, which stops a row being its own
-- direct parent. That is not enough: the statement
--
--   UPDATE categories SET parent_id = 'smartphones' WHERE slug = 'electronics';
--
-- is legal even though Smartphones is a descendant of Electronics, and it turns
-- the tree into a cycle. Every recursive query over categories then loops
-- forever or trips the default statement timeout, so the cycle has to be
-- rejected at write time rather than discovered later.
--
-- A CHECK constraint cannot express this: the rule spans rows, and CHECK only
-- ever sees the row being written.

CREATE OR REPLACE FUNCTION prevent_category_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_found BOOLEAN;
BEGIN
  -- A NULL parent is a root, which is always allowed.
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Walk up from the proposed parent. If we meet the row being written, the new
  -- parent is this row's own descendant and the update would create a cycle.
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id
      FROM categories
     WHERE id = NEW.parent_id
    UNION ALL
    SELECT c.id, c.parent_id
      FROM categories c
      JOIN ancestors a ON c.id = a.parent_id
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION
      'category cycle: cannot move "%" (id %) under "%" (id %), because that is its own descendant',
      COALESCE(NEW.name, '<unnamed>'), NEW.id, COALESCE(NEW.parent_id::TEXT, 'null'), NEW.parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION prevent_category_cycle() IS
  'BEFORE INSERT OR UPDATE guard rejecting a parent_id that would make the category tree cyclic.';

DROP TRIGGER IF EXISTS trg_categories_prevent_cycle ON categories;

CREATE TRIGGER trg_categories_prevent_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_category_cycle();

-- ROLLBACK (down)
-- DROP TRIGGER IF EXISTS trg_categories_prevent_cycle ON categories;
-- DROP FUNCTION IF EXISTS prevent_category_cycle();