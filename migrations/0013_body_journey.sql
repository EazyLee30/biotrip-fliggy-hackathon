-- Explicit state and subjective outcomes stay separate from wearable measurements.
CREATE TABLE body_check_ins (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL,
 journey_id TEXT NOT NULL,
 local_date TEXT NOT NULL,
 timezone TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 recorded_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(account_id,journey_id,request_key),
 FOREIGN KEY(journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE
);
CREATE INDEX body_check_in_current ON body_check_ins(account_id,journey_id,local_date,recorded_at DESC);
CREATE TABLE journey_adjustments (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL,
 journey_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 outcome_json TEXT,
 outcome_key TEXT,
 outcome_hash TEXT,
 applied_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(account_id,job_id),
 FOREIGN KEY(journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE
);
CREATE INDEX adjustment_journey_history ON journey_adjustments(account_id,journey_id,applied_at DESC);
