-- Add auth_provider to users to distinguish password vs SSO accounts
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password';

-- Password reset tokens table (single-use, 1-hour TTL)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           varchar(50) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      varchar(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamp   NOT NULL,
  used_at      timestamp,
  created_at   timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prt_user_id_idx  ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS prt_expires_idx  ON password_reset_tokens(expires_at);
