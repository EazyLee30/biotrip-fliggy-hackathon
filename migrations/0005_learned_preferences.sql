PRAGMA foreign_keys = ON;

-- BioTrip learns preferences from what the traveller actually chooses. Rows are
-- derived only from the traveller's own actions (planning style, ambience,
-- services, feedback), never from WHOOP numbers, and every row can be reviewed
-- or deleted. Repeated identical choices raise `hits`, which is what lets the
-- planner prefill a new trip with a preference the traveller proved they want.
CREATE TABLE learned_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'rhythm', 'ambience', 'intention', 'tone', 'food', 'service', 'destination', 'schedule'
  )),
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'choice' CHECK (source IN ('choice', 'feedback', 'profile')),
  hits INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (account_id, kind, value)
);

CREATE INDEX learned_preferences_account_idx
  ON learned_preferences(account_id, kind, hits DESC, last_seen_at DESC);
