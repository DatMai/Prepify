-- Opaque browser sessions and one-time OAuth PKCE state.
-- Security-question recovery is removed in favor of one-time email tokens.

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_active_user
  ON sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash    CHAR(64) PRIMARY KEY,
  provider      VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'facebook')),
  code_verifier VARCHAR(255) NOT NULL,
  return_path   VARCHAR(255) NOT NULL DEFAULT '/',
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_flows_expiry ON oauth_flows (expires_at);

ALTER TABLE users
  DROP COLUMN IF EXISTS security_question,
  DROP COLUMN IF EXISTS security_answer_hash;
