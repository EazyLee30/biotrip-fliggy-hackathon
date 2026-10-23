PRAGMA foreign_keys = ON;
ALTER TABLE learned_preferences RENAME TO learned_preferences_old;
CREATE TABLE learned_preferences (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('rhythm','pace','guardrail','ambience','intention','tone','food','service','destination','home','schedule')),
 value TEXT NOT NULL, label TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'choice' CHECK(source IN ('choice','feedback','profile')), hits INTEGER NOT NULL DEFAULT 1,
 first_seen_at INTEGER NOT NULL DEFAULT(unixepoch()), last_seen_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(account_id,kind,value)
);
INSERT INTO learned_preferences SELECT * FROM learned_preferences_old;
DELETE FROM learned_preferences WHERE kind='schedule';
DROP TABLE learned_preferences_old;
CREATE INDEX learned_preferences_account_idx ON learned_preferences(account_id,kind,hits DESC,last_seen_at DESC);

INSERT OR IGNORE INTO learned_preferences(id,account_id,kind,value,label,source,hits)
 SELECT 'home_'||account_id,account_id,'home',home_city,home_city,'profile',2 FROM profiles WHERE trim(home_city)<>'';
CREATE TABLE memory_items (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 note TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'preference',
 scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','journey','day')),
 journey_id TEXT,
 expires_on TEXT,
 enabled INTEGER NOT NULL DEFAULT 1,
 deleted INTEGER NOT NULL DEFAULT 0,
 source TEXT NOT NULL,
 source_id TEXT,
 dedupe_key TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(account_id,dedupe_key),
 FOREIGN KEY(journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE
);
CREATE INDEX memory_items_account_idx ON memory_items(account_id,deleted,enabled);
INSERT INTO memory_items(id,account_id,note,source,source_id,dedupe_key)
 SELECT 'feedback_'||id,account_id,note,'feedback',id,'feedback:'||id FROM journey_memories;
INSERT INTO memory_items(id,account_id,note,source,source_id,dedupe_key)
 SELECT 'profile_'||account_id,account_id,memory_notes,'profile',account_id,'profile:notes' FROM profiles WHERE trim(memory_notes)<>'';
INSERT INTO memory_items(id,account_id,note,category,source,source_id,dedupe_key,enabled)
 SELECT 'learned_'||id,account_id,label,kind,'choice',id,'choice:'||kind||':'||value,CASE WHEN hits>=2 THEN 1 ELSE 0 END
 FROM learned_preferences WHERE hits>=2 AND kind NOT IN ('schedule','destination');
CREATE TABLE agent_settings (
 account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 auto_memory INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE agent_conversations (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 journey_id TEXT,
 title TEXT NOT NULL DEFAULT '新的对话',
 busy_request TEXT,
 busy_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(id,account_id),
 FOREIGN KEY(journey_id,account_id) REFERENCES journeys(id,account_id) ON DELETE CASCADE
);
CREATE TABLE agent_messages (
 id TEXT PRIMARY KEY NOT NULL,
 conversation_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 content TEXT NOT NULL,
 payload_json TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 FOREIGN KEY(conversation_id,account_id) REFERENCES agent_conversations(id,account_id) ON DELETE CASCADE
);
CREATE INDEX agent_messages_conversation_idx ON agent_messages(conversation_id,created_at);
CREATE TABLE agent_actions (
 id TEXT PRIMARY KEY NOT NULL,
 conversation_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','applying','applied','discarded','failed')),
 result_json TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 FOREIGN KEY(conversation_id,account_id) REFERENCES agent_conversations(id,account_id) ON DELETE CASCADE
);
