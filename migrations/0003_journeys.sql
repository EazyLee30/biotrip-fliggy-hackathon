PRAGMA foreign_keys = ON;

CREATE TABLE journeys (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'active', 'completed')),
  draft_json TEXT NOT NULL DEFAULT '{}',
  plan_json TEXT,
  plan_draft_json TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  completed_at INTEGER,
  UNIQUE (id, account_id)
);

CREATE INDEX journeys_account_updated_idx ON journeys(account_id, updated_at DESC);

CREATE TABLE journey_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  journey_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (journey_id, account_id) REFERENCES journeys(id, account_id) ON DELETE CASCADE,
  UNIQUE (id, account_id)
);

CREATE INDEX journey_feedback_journey_idx ON journey_feedback(journey_id, account_id, created_at DESC);

CREATE TABLE journey_memories (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  feedback_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (feedback_id, account_id) REFERENCES journey_feedback(id, account_id) ON DELETE CASCADE
);

CREATE INDEX journey_memories_account_idx ON journey_memories(account_id, created_at DESC);
