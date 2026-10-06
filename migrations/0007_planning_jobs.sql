-- Durable planning state; account ownership is enforced by composite foreign keys.
CREATE TABLE planning_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 journey_id TEXT NOT NULL,
 base_version INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 request_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','awaiting_approval','completed','failed','indeterminate','cancel_requested','cancelled')),
 candidate_json TEXT,
 error_code TEXT,
 error_message TEXT,
 lease_token INTEGER NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 expires_at INTEGER NOT NULL DEFAULT(unixepoch()+604800),
 UNIQUE(account_id,idempotency_key),
 FOREIGN KEY(journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX planning_one_active ON planning_jobs(account_id) WHERE state IN ('queued','running','cancel_requested');
CREATE INDEX planning_job_account ON planning_jobs(account_id,created_at DESC);
CREATE TABLE planning_job_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL REFERENCES planning_jobs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('progress','recommendations')),
 payload_json TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX planning_events_cursor ON planning_job_events(job_id,seq);
CREATE TABLE planning_job_stages (
 job_id TEXT NOT NULL REFERENCES planning_jobs(id) ON DELETE CASCADE,
 stage TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('started','completed','failed')),
 result_json TEXT,
 session_id TEXT,
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 PRIMARY KEY(job_id,stage)
);
CREATE TABLE journey_versions (
 journey_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 draft_json TEXT NOT NULL,
 plan_json TEXT NOT NULL,
 plan_draft_json TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 PRIMARY KEY(journey_id,version),
 FOREIGN KEY(journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE
);
-- Atomic snapshots in the same transaction as the plan write, including legacy callers.
INSERT INTO journey_versions(journey_id,account_id,version,draft_json,plan_json,plan_draft_json)
 SELECT id,account_id,version,draft_json,plan_json,COALESCE(plan_draft_json,draft_json) FROM journeys WHERE plan_json IS NOT NULL;
CREATE TRIGGER journey_version_insert AFTER INSERT ON journeys WHEN NEW.plan_json IS NOT NULL BEGIN
 INSERT INTO journey_versions VALUES(NEW.id,NEW.account_id,NEW.version,NEW.draft_json,NEW.plan_json,COALESCE(NEW.plan_draft_json,NEW.draft_json),unixepoch());
END;
CREATE TRIGGER journey_version_update AFTER UPDATE OF plan_json ON journeys WHEN NEW.plan_json IS NOT NULL AND (OLD.plan_json IS NULL OR NEW.plan_json <> OLD.plan_json) BEGIN
 INSERT INTO journey_versions VALUES(NEW.id,NEW.account_id,NEW.version,NEW.draft_json,NEW.plan_json,COALESCE(NEW.plan_draft_json,NEW.draft_json),unixepoch());
 DELETE FROM journey_versions WHERE journey_id=NEW.id AND version NOT IN (SELECT version FROM journey_versions WHERE journey_id=NEW.id ORDER BY version DESC LIMIT 30);
END;
