-- 016_create_payments.sql
-- Payments are separate records, not columns on orders.
--
-- Why the split
--   One order can have several payment rows: a failed online attempt followed by
--   a successful one, a partial refund, a retry after a timeout. Forcing one
--   payment per order would lose that history, so order_id is not unique.
--   orders.payment_status is the denormalised summary of the latest row, kept
--   for cheap listing and filtering; payments is the audit trail.
--
-- Provider
--   `provider` is a free-form VARCHAR, not an enum or a CHECK list, so
--   TeleBirr, Stripe or Paystack can be connected later without a migration.
--   For cash on delivery the provider is the store itself.
--
-- ON DELETE RESTRICT on order_id: financial records are never removed by
-- deleting the order they belong to.

CREATE TABLE IF NOT EXISTS payments (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID         NOT NULL,
  provider             VARCHAR(40)  NOT NULL DEFAULT 'INTERNAL',
  method               VARCHAR(20)  NOT NULL DEFAULT 'COD',
  status               VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  amount               BIGINT       NOT NULL,
  currency             CHAR(3)      NOT NULL DEFAULT 'ETB',
  transaction_reference VARCHAR(128),
  failure_reason       VARCHAR(255),
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT payments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT payments_method_allowed CHECK (method IN ('COD', 'ONLINE')),
  CONSTRAINT payments_status_allowed CHECK (
    status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')
  ),
  CONSTRAINT payments_provider_required CHECK (BTRIM(provider) <> ''),
  CONSTRAINT payments_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT payments_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- A PAID or REFUNDED row must record when the money moved.
  CONSTRAINT payments_paid_at_when_settled CHECK (
    status NOT IN ('PAID', 'REFUNDED') OR paid_at IS NOT NULL
  ),
  -- A FAILED row should say why; other rows have no reason to.
  CONSTRAINT payments_failure_reason_when_failed CHECK (
    status <> 'FAILED' OR COALESCE(BTRIM(failure_reason), '') <> ''
  )
);

COMMENT ON TABLE payments IS
  'Payment attempts and settlements for an order. Several rows per order are allowed.';
COMMENT ON COLUMN payments.provider IS
  'Payment provider (INTERNAL, TELEBIRR, STRIPE, PAYSTACK, ...). Free-form so new providers need no migration.';
COMMENT ON COLUMN payments.method IS
  'COD (cash on delivery) or ONLINE (provider confirmed).';
COMMENT ON COLUMN payments.transaction_reference IS
  'Provider-side transaction id. Unique when present, so the same callback cannot be recorded twice.';
COMMENT ON COLUMN payments.amount IS
  'Amount in minor units (ETB cents).';

-- Payment attempts of one order, newest first.
CREATE INDEX IF NOT EXISTS idx_payments_order_id
  ON payments (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments (provider);

-- The same provider transaction can never be recorded twice (webhook replay).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_reference
  ON payments (transaction_reference) WHERE transaction_reference IS NOT NULL;

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS payments;
