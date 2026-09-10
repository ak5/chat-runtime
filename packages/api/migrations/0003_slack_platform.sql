PRAGMA defer_foreign_keys = ON;

CREATE TABLE runtime_events_new (
  event_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack')),
  event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
  bot_identity_id TEXT, payload_json TEXT NOT NULL, metadata_json TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received', retain_until TEXT
);
INSERT INTO runtime_events_new SELECT * FROM runtime_events;

CREATE TABLE messages_new (
  platform TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
  author_id TEXT, author_display_name TEXT, reply_to_message_id TEXT, thread_id TEXT,
  text_content TEXT, attachments_json TEXT NOT NULL DEFAULT '[]', occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, source_event_id TEXT NOT NULL REFERENCES runtime_events_new(event_id),
  retain_until TEXT, PRIMARY KEY (platform, conversation_id, message_id)
);
INSERT INTO messages_new SELECT * FROM messages;

CREATE TABLE event_deliveries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES runtime_events_new(event_id),
  attempted_at TEXT NOT NULL, result TEXT NOT NULL, idempotent_replay INTEGER NOT NULL DEFAULT 0, retain_until TEXT
);
INSERT INTO event_deliveries_new SELECT * FROM event_deliveries;

CREATE TABLE action_plans_new (
  plan_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack')),
  event_id TEXT, plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'leased', 'completed', 'expired')),
  available_at TEXT NOT NULL, expires_at TEXT, lease_id TEXT, lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, completed_at TEXT, retain_until TEXT
);
INSERT INTO action_plans_new SELECT * FROM action_plans;

CREATE TABLE action_receipts_new (
  receipt_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES action_plans_new(plan_id), action_id TEXT NOT NULL,
  installation_id TEXT NOT NULL, platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram', 'slack')),
  status TEXT NOT NULL, occurred_at TEXT NOT NULL, external_id TEXT, error_json TEXT,
  receipt_json TEXT NOT NULL, received_at TEXT NOT NULL, retain_until TEXT, UNIQUE (plan_id, action_id)
);
INSERT INTO action_receipts_new SELECT * FROM action_receipts;

DROP TABLE action_receipts;
DROP TABLE action_plans;
DROP TABLE event_deliveries;
DROP TABLE messages;
DROP TABLE runtime_events;

ALTER TABLE runtime_events_new RENAME TO runtime_events;
ALTER TABLE messages_new RENAME TO messages;
ALTER TABLE event_deliveries_new RENAME TO event_deliveries;
ALTER TABLE action_plans_new RENAME TO action_plans;
ALTER TABLE action_receipts_new RENAME TO action_receipts;

CREATE INDEX runtime_events_received_idx ON runtime_events(received_at);
CREATE INDEX messages_occurred_idx ON messages(occurred_at);
CREATE INDEX event_deliveries_retention_idx ON event_deliveries(retain_until);
CREATE INDEX action_plans_outbox_idx ON action_plans(status, platform, available_at);
