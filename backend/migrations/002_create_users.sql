-- 002_create_users.sql
-- Registered customers and administrators.
--
-- Passwords are never stored in plain text: the CHECK constraint accepts only
-- modular-crypt (PHC) formatted hashes (bcrypt "$2b$...", Argon2 "$argon2id$...",
-- scrypt "$7$..."), so a plaintext value is rejected by the database itself.
-- SELLER is reserved: it is accepted so a marketplace can be added later
-- without rewriting the user model, but nothing assigns it in v1.

CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(120) NOT NULL,
  email               VARCHAR(255) NOT NULL,
  phone               VARCHAR(20),
  password_hash       TEXT         NOT NULL,
  role                VARCHAR(20)  NOT NULL DEFAULT 'CUSTOMER',
  status              VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  last_login_at       TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_format CHECK (
    email = LOWER(BTRIM(email))
    AND POSITION('@' IN email) > 1
  ),
  CONSTRAINT users_password_hash_is_hashed CHECK (
    password_hash ~ '^\$[0-9a-z]{1,4}\$'
  ),
  CONSTRAINT users_phone_format CHECK (
    phone IS NULL OR phone ~ '^\+?[0-9]{9,15}$'
  ),
  CONSTRAINT users_role_allowed CHECK (role IN ('CUSTOMER', 'ADMIN', 'SELLER')),
  CONSTRAINT users_status_allowed CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE'))
);

COMMENT ON TABLE users IS
  'Registered customers and administrators. SELLER is reserved for a future marketplace.';
COMMENT ON COLUMN users.password_hash IS
  'Modular-crypt hash (bcrypt/argon2/scrypt). Never a plain-text password.';
COMMENT ON COLUMN users.status IS
  'Account lifecycle state, independent of role: ACTIVE, SUSPENDED or INACTIVE.';

-- No LOWER(email) index: the email CHECK guarantees every stored value is
-- already lower-cased, so UNIQUE (email) also serves case-insensitive lookups.
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS users;
