CREATE TABLE IF NOT EXISTS connections (
  chat_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  secret TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, owner)
);
CREATE INDEX IF NOT EXISTS connections_by_owner ON connections(owner);
