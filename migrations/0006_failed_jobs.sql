CREATE TABLE IF NOT EXISTS failed_jobs (
  delivery_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  thread_id INTEGER,
  silent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, chat_id)
);
CREATE INDEX IF NOT EXISTS failed_jobs_by_chat ON failed_jobs(chat_id, failed_at DESC);
