PRAGMA foreign_keys = ON;

-- BioTrip keeps one WHOOP connection per account so a single authorisation
-- survives cookie clears, new browsers and new devices. Only the ciphertext of
-- the OAuth tokens is stored, produced by AES-256-GCM with WHOOP_COOKIE_SECRET;
-- plaintext tokens never reach the database, a log or the browser. Deleting the
-- row is the single "disconnect" action, and the account cascade removes it.
CREATE TABLE whoop_connections (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_ciphertext TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  access_expires_at INTEGER NOT NULL,
  profile_first_name TEXT NOT NULL DEFAULT '',
  profile_last_name TEXT NOT NULL DEFAULT '',
  profile_email TEXT NOT NULL DEFAULT '',
  connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX whoop_connections_updated_idx ON whoop_connections(updated_at);

-- The display name of the connected WHOOP member is kept so the interface can
-- confirm which account is linked without asking WHOOP on every page load.
ALTER TABLE whoop_connections ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
