DROP TABLE IF EXISTS reminder_deliveries;
DROP TABLE IF EXISTS push_tokens;

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
