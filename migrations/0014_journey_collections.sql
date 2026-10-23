CREATE TABLE IF NOT EXISTS journey_collection_items (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  journey_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('backlog','checklist')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0,1)),
  source_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE,
  UNIQUE(account_id,journey_id,kind,source_key)
);
CREATE INDEX IF NOT EXISTS journey_collection_lookup ON journey_collection_items(account_id,journey_id,kind,created_at DESC);
