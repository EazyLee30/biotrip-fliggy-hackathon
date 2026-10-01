PRAGMA foreign_keys = ON;

-- Daily pace and standing guardrails became first-class learned preferences, so
-- the kind allowlist has to include them. SQLite cannot widen a CHECK in place,
-- so the table is rebuilt and every existing row is carried over.
ALTER TABLE learned_preferences RENAME TO learned_preferences_previous;

CREATE TABLE learned_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'rhythm', 'pace', 'guardrail', 'ambience', 'intention',
    'tone', 'food', 'service', 'destination', 'schedule'
  )),
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'choice' CHECK (source IN ('choice', 'feedback', 'profile')),
  hits INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (account_id, kind, value)
);

INSERT INTO learned_preferences
  (id, account_id, kind, value, label, source, hits, first_seen_at, last_seen_at)
SELECT id, account_id, kind, value, label, source, hits, first_seen_at, last_seen_at
FROM learned_preferences_previous;

DROP TABLE learned_preferences_previous;

CREATE INDEX learned_preferences_account_idx
  ON learned_preferences(account_id, kind, hits DESC, last_seen_at DESC);