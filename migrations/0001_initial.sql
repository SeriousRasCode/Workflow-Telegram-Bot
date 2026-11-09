CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  chat_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  PRIMARY KEY (chat_id, repo),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS subscriptions_by_repo ON subscriptions(repo);

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, chat_id)
);
CREATE INDEX IF NOT EXISTS deliveries_by_age ON deliveries(sent_at);
