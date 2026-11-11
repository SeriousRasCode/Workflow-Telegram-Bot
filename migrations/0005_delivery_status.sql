CREATE TABLE IF NOT EXISTS delivery_status (
  chat_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS delivery_status_by_chat ON delivery_status(chat_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS digest_job_items (
  job_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  PRIMARY KEY (job_id, chat_id, delivery_id)
);
