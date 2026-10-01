PRAGMA foreign_keys = ON;

-- Existing accounts, profiles and sessions remain intact.
ALTER TABLE login_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';

CREATE TABLE account_passwords (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE auth_rate_limits (
  limit_key TEXT PRIMARY KEY NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits(reset_at);
