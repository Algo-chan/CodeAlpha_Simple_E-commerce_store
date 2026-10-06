-- 020_create_user_sessions.sql
-- Server-side sessions for the customer authentication system (Phase 6).
--
-- Sessions are opaque random tokens issued in a secure httpOnly cookie. The
-- cookie carries the token, the database stores only its SHA-256 hash, so a
-- dump of the sessions table yields nothing that can be replayed. Keeping the
-- session server-side (rather than a stateless JWT) is what makes logout a real
-- revocation: deleting the row invalidates the session immediately, and there
-- is no expiry/secret-window to argue about.
--
-- The updated_at trigger is added here rather than back in 018 because this
-- table did not exist when that migration ran. It uses the shared helper from
-- 001 so nothing else in the schema needs to change.

CREATE TABLE IF NOT EXISTS user_sessions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL,
  token_hash  CHAR(64)     NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  user_agent  VARCHAR(255),
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT user_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT user_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT user_sessions_token_hash_is_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE user_sessions IS
  'Authenticated browser sessions. Stores only the SHA-256 of the cookie value.';
COMMENT ON COLUMN user_sessions.token_hash IS
  'sha256(token) from the httpOnly cookie. Never the token itself.';

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

CREATE TRIGGER user_sessions_set_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ROLLBACK (down)
-- DROP TRIGGER IF EXISTS user_sessions_set_updated_at ON user_sessions;
-- DROP TABLE IF EXISTS user_sessions;