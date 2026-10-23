PRAGMA foreign_keys = ON;
CREATE TABLE memory_changes (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL,
 previous_json TEXT,
 applied_version INTEGER NOT NULL,
 used INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX memory_changes_account_idx ON memory_changes(account_id,memory_id);
