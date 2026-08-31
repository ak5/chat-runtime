PRAGMA foreign_keys = ON;

CREATE TABLE runtime_events (
  event_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram')),
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  bot_identity_id TEXT,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  retain_until TEXT
);
CREATE INDEX runtime_events_received_idx ON runtime_events(received_at);

CREATE TABLE messages (
  platform TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  author_id TEXT,
  author_display_name TEXT,
  reply_to_message_id TEXT,
  thread_id TEXT,
  text_content TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  source_event_id TEXT NOT NULL REFERENCES runtime_events(event_id),
  retain_until TEXT,
  PRIMARY KEY (platform, conversation_id, message_id)
);
CREATE INDEX messages_occurred_idx ON messages(occurred_at);

CREATE TABLE event_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES runtime_events(event_id),
  attempted_at TEXT NOT NULL,
  result TEXT NOT NULL,
  idempotent_replay INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE action_plans (
  plan_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram')),
  event_id TEXT,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'leased', 'completed', 'expired')),
  available_at TEXT NOT NULL,
  expires_at TEXT,
  lease_id TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  retain_until TEXT
);
CREATE INDEX action_plans_outbox_idx ON action_plans(status, platform, available_at);

CREATE TABLE action_receipts (
  receipt_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES action_plans(plan_id),
  action_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'telegram')),
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  external_id TEXT,
  error_json TEXT,
  receipt_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  retain_until TEXT,
  UNIQUE (plan_id, action_id)
);

CREATE TABLE request_nonces (
  installation_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  request_timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (installation_id, nonce)
);
CREATE INDEX request_nonces_expiry_idx ON request_nonces(expires_at);

CREATE TABLE runtime_health (
  installation_id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  health_json TEXT NOT NULL
);
