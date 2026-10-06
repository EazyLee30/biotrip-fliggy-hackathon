-- Adjustment candidates share task ownership, idempotency and expiry with planning.
ALTER TABLE planning_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'plan' CHECK(mode IN ('plan','adjust'));
-- Public city imagery contains no account or body data.
CREATE TABLE destination_visuals (
 city TEXT PRIMARY KEY NOT NULL,
 sources_json TEXT NOT NULL,
 retrieved_at INTEGER NOT NULL DEFAULT(unixepoch()),
 expires_at INTEGER NOT NULL DEFAULT(unixepoch()+604800)
);
