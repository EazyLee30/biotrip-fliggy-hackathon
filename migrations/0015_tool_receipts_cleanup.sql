-- Public search results are account-scoped and short-lived. No credentials,
-- prompts, WHOOP values or original body feedback are persisted here.
CREATE TABLE travel_search_runs (
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 expires_at INTEGER NOT NULL DEFAULT(unixepoch()+86400),
 PRIMARY KEY(account_id,request_key)
);
CREATE TABLE travel_search_queries (
 account_id TEXT NOT NULL,
 request_key TEXT NOT NULL,
 query_key TEXT NOT NULL,
 tool TEXT NOT NULL,
 category TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('started','completed','empty','failed','unknown')),
 offers_json TEXT NOT NULL DEFAULT '[]',
 elapsed_ms INTEGER NOT NULL DEFAULT 0,
 code TEXT,
 retrieved_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_key,query_key),
 FOREIGN KEY(account_id,request_key) REFERENCES travel_search_runs(account_id,request_key) ON DELETE CASCADE
);
CREATE TABLE agent_session_cleanup (
 session_id TEXT PRIMARY KEY NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT(unixepoch()+300),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 last_status INTEGER
);
CREATE INDEX agent_session_cleanup_due ON agent_session_cleanup(next_attempt_at);
