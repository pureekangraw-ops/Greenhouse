-- Additive only. Apply explicitly after backup/review; no runtime schema creation.
CREATE TABLE IF NOT EXISTS ygg_sessions (
 token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ygg_requests (
 request_id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL,
 brief_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
 responder_type TEXT NOT NULL DEFAULT 'AI', responder_id TEXT NOT NULL DEFAULT 'go',
 version INTEGER NOT NULL DEFAULT 0, last_mutation TEXT,
 work_id TEXT UNIQUE, delivery_url TEXT, delivery_text TEXT, delivery_sha256 TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ygg_requests_owner ON ygg_requests(owner_hash,updated_at);
CREATE TABLE IF NOT EXISTS ygg_messages (
 message_id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES ygg_requests(request_id),
 sender_type TEXT NOT NULL CHECK(sender_type IN ('CUSTOMER','AI','ADMIN','SYSTEM')),
 sender_id TEXT NOT NULL, text TEXT NOT NULL, timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ygg_messages_request ON ygg_messages(request_id,timestamp,message_id);
CREATE TABLE IF NOT EXISTS ygg_request_events (
 event_id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES ygg_requests(request_id),
 kind TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
 from_value TEXT, to_value TEXT NOT NULL, timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ygg_events_request ON ygg_request_events(request_id,timestamp,event_id);
