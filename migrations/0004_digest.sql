CREATE TABLE IF NOT EXISTS digest_items (
  delivery_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, chat_id)
);
CREATE INDEX IF NOT EXISTS digest_items_by_chat ON digest_items(chat_id, created_at);
