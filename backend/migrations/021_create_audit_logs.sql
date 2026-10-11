-- 021_create_audit_logs.sql
-- Append-only record of sensitive administrative actions (Phase 10).
--
-- Why a separate table
--   Nothing else in the schema answers "who changed this, and what did it look
--   like before?". The stock ledger records stock movements; the payments and
--   orders tables record what a customer did. This table records what an
--   ADMINISTRATOR did to the store: a product was archived, a price moved, an
--   order status was advanced, a customer was suspended, a review was moderated.
--
-- Append-only by construction
--   There is no updated_at column and no trigger, exactly like
--   inventory_transactions. An audit row is written once and never edited, so
--   it cannot be quietly rewritten to hide an action.
--
-- actor_id is NULLable and ON DELETE SET NULL
--   Deleting the staff account must not erase the history of what that account
--   did. The actor's email is copied onto the row at write time for the same
--   reason the order carries customer_email: the record has to stay readable
--   after the referenced row is gone.
--
-- changes is a JSONB { before, after } document, free-form because different
-- entities expose different fields. It is optional: an action whose effect is
-- fully described by `summary` (an order status change) does not need a diff.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID,
  actor_email VARCHAR(255),
  action      VARCHAR(60)  NOT NULL,
  entity_type VARCHAR(40)  NOT NULL,
  entity_id   VARCHAR(64),
  summary     TEXT,
  changes     JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT audit_logs_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT audit_logs_action_required CHECK (BTRIM(action) <> ''),
  CONSTRAINT audit_logs_entity_type_required CHECK (BTRIM(entity_type) <> ''),
  CONSTRAINT audit_logs_changes_is_object CHECK (
    changes IS NULL OR JSONB_TYPEOF(changes) = 'object'
  )
);

COMMENT ON TABLE audit_logs IS
  'Append-only trail of administrative actions. Written once, never updated.';
COMMENT ON COLUMN audit_logs.actor_id IS
  'The admin who acted. NULL if the account was later deleted; actor_email is the snapshot.';
COMMENT ON COLUMN audit_logs.entity_id IS
  'Identifier of the affected row, as text so it fits every entity. Never a foreign key.';
COMMENT ON COLUMN audit_logs.changes IS
  'Optional { before, after } diff describing the change.';

-- "Everything that happened to this entity."
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);
-- "What has this administrator been doing?"
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_id, created_at DESC);
-- The global, newest-first feed.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action, created_at DESC);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS audit_logs;
