CREATE TABLE IF NOT EXISTS user_chat_contexts (
  user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
