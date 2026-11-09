CREATE TABLE IF NOT EXISTS jobs (
  delivery_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  thread_id INTEGER,
  silent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, chat_id)
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(next_attempt_at);
