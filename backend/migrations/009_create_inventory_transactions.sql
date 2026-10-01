-- 009_create_inventory_transactions.sql
-- Append-only audit trail of every stock movement.
--
-- `quantity` is signed and its sign must agree with `transaction_type`:
-- stock-in types are positive, stock-out types are negative, ADJUSTMENT may be
-- either. That check makes an incoherent row (a "SALE that adds stock")
-- impossible to insert.
--
-- The polymorphic reference (reference_type + reference_id) points at whatever
-- caused the movement - an order today, a purchase order later. It is
-- deliberately not a real foreign key, so a reference id is meaningless
-- without its type and the CHECK requires the type to be present whenever an
-- id is. A type on its own is fine: MANUAL with no id means "a person adjusted
-- this, there is no document behind it".
--
-- ON DELETE RESTRICT on variant_id: history is never deleted with the product.
--
-- No updated_at: this table is written once and never updated.

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id       UUID        NOT NULL,
  transaction_type VARCHAR(20) NOT NULL,
  quantity         INTEGER     NOT NULL,
  reference_type   VARCHAR(30),
  reference_id     UUID,
  note             TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT inventory_transactions_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE RESTRICT,
  CONSTRAINT inventory_transactions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT inventory_transactions_type_allowed CHECK (
    transaction_type IN ('RESTOCK', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT')
  ),
  CONSTRAINT inventory_transactions_quantity_not_zero CHECK (quantity <> 0),
  CONSTRAINT inventory_transactions_sign_matches_type CHECK (
    (transaction_type IN ('RESTOCK', 'RETURN') AND quantity > 0)
    OR (transaction_type IN ('SALE', 'DAMAGE') AND quantity < 0)
    OR (transaction_type = 'ADJUSTMENT')
  ),
  CONSTRAINT inventory_transactions_reference_type_allowed CHECK (
    reference_type IS NULL OR reference_type IN ('ORDER', 'SUPPLIER', 'MANUAL')
  ),
  CONSTRAINT inventory_transactions_reference_id_needs_type CHECK (
    reference_id IS NULL OR reference_type IS NOT NULL
  )
);

COMMENT ON TABLE inventory_transactions IS
  'Append-only stock ledger. Signed quantity; the sign must match the transaction type.';
COMMENT ON COLUMN inventory_transactions.quantity IS
  'Signed movement. Positive adds stock (RESTOCK/RETURN), negative removes it (SALE/DAMAGE).';
COMMENT ON COLUMN inventory_transactions.reference_type IS
  'What caused the movement: ORDER, SUPPLIER or MANUAL. Required whenever reference_id is set.';

-- Per-variant history, newest first.
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_variant_id
  ON inventory_transactions (variant_id, created_at DESC);
-- "Show me every movement caused by this order".
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reference
  ON inventory_transactions (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_at
  ON inventory_transactions (created_at DESC);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS inventory_transactions;
