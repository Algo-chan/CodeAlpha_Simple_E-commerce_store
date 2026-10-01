-- 010_create_carts.sql
-- One table serves both guest and signed-in carts.
--
-- A cart is identified by exactly one owner reference, enforced by the CHECK:
--   user_id NULL      -> guest cart, tracked by `session_token`
--   session_token NULL-> signed-in cart, tracked by user_id
--
-- `session_token` holds a cryptographically random identifier taken from an
-- httpOnly cookie set by the cart API. It is not a user credential, so it
-- carries no privileges; the application generates it with a CSPRNG
-- (>= 128 bits of entropy) and must never derive it from an IP or a user id.
--
-- Cart merge on login: the guest cart row is kept and flipped to CONVERTED
-- with merged_into_cart_id pointing at the customer's cart, so the merge is
-- traceable and idempotent. The two partial unique indexes guarantee a single
-- ACTIVE cart per user and per session no matter how many historical carts
-- exist.

CREATE TABLE IF NOT EXISTS carts (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID,
  session_token      VARCHAR(128),
  status             VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  merged_into_cart_id UUID,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT carts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT carts_merged_into_cart_id_fkey
    FOREIGN KEY (merged_into_cart_id) REFERENCES carts (id) ON DELETE SET NULL,
  CONSTRAINT carts_exactly_one_owner CHECK (
    (user_id IS NULL) <> (session_token IS NULL)
  ),
  CONSTRAINT carts_session_token_required CHECK (
    session_token IS NULL OR CHAR_LENGTH(session_token) >= 32
  ),
  CONSTRAINT carts_status_allowed CHECK (
    status IN ('ACTIVE', 'CONVERTED', 'ABANDONED')
  ),
  CONSTRAINT carts_not_merged_into_itself CHECK (
    merged_into_cart_id IS NULL OR merged_into_cart_id <> id
  )
);

COMMENT ON TABLE carts IS
  'Guest carts (session_token) and customer carts (user_id). Exactly one owner per cart.';
COMMENT ON COLUMN carts.session_token IS
  'Opaque random id from an httpOnly cookie. >= 32 chars of CSPRNG entropy; never derived from the request.';
COMMENT ON COLUMN carts.merged_into_cart_id IS
  'Set when this guest cart was merged into a customer cart on login.';

-- One live cart per customer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_one_active_per_user
  ON carts (user_id) WHERE user_id IS NOT NULL AND status = 'ACTIVE';
-- One live cart per guest session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_one_active_per_session
  ON carts (session_token) WHERE session_token IS NOT NULL AND status = 'ACTIVE';
-- Supports the guest-cart cleanup job.
CREATE INDEX IF NOT EXISTS idx_carts_expires_at
  ON carts (expires_at) WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS carts;
