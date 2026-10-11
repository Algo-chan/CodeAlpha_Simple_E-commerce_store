-- 022_add_review_moderation.sql
-- Records who moderated a review, when, and why.
--
-- 017 modelled the moderation STATE (status: PENDING/APPROVED/REJECTED) but not
-- the moderation ACT. Approving or hiding a review is a decision with a reason,
-- and "hide this review" without recording who hid it and why is exactly the
-- kind of silent action the audit requirement exists to prevent.
--
-- Author content is never touched. Moderating a review changes only these
-- columns and `status`; `title`, `comment` and `rating` stay as the customer
-- wrote them, so a rejected review can be inspected rather than destroyed.
--
-- moderated_by is ON DELETE SET NULL for the same reason audit_logs.actor_id is:
-- removing a staff account must not erase the moderation history.
--
-- Columns are nullable on purpose. A seeded or customer-submitted review starts
-- PENDING with no moderator; the columns fill in the first time an admin acts.

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_by UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_note VARCHAR(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_moderated_by_fkey'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_moderated_by_fkey
        FOREIGN KEY (moderated_by) REFERENCES users (id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN reviews.moderated_by IS
  'Admin who last approved or rejected this review. NULL until moderated.';
COMMENT ON COLUMN reviews.moderated_at IS
  'When the moderation decision was recorded.';
COMMENT ON COLUMN reviews.moderation_note IS
  'Optional reason kept alongside the decision (never edits the author content).';

-- ROLLBACK (down)
-- ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_moderated_by_fkey;
-- ALTER TABLE reviews DROP COLUMN IF EXISTS moderated_by;
-- ALTER TABLE reviews DROP COLUMN IF EXISTS moderated_at;
-- ALTER TABLE reviews DROP COLUMN IF EXISTS moderation_note;
