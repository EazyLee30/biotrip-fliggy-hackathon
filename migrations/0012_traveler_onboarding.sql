PRAGMA foreign_keys = ON;
CREATE TABLE traveler_onboarding (
 account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('completed','skipped')),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
