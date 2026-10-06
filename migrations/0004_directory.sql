ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN removed_at TEXT;

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
