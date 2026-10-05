CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  accent TEXT NOT NULL DEFAULT 'teal' CHECK (accent IN ('teal', 'blue', 'green', 'orange')),
  speak_replies INTEGER NOT NULL DEFAULT 0 CHECK (speak_replies IN (0, 1)),
  speech_rate REAL NOT NULL DEFAULT 0.5 CHECK (speech_rate >= 0 AND speech_rate <= 1),
  notify_reminders INTEGER NOT NULL DEFAULT 1 CHECK (notify_reminders IN (0, 1)),
  notify_sound INTEGER NOT NULL DEFAULT 1 CHECK (notify_sound IN (0, 1)),
  notify_badge INTEGER NOT NULL DEFAULT 1 CHECK (notify_badge IN (0, 1)),
  quiet_start TEXT,
  quiet_end TEXT
);

CREATE TABLE push_tokens (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  updated_at TEXT NOT NULL,
  UNIQUE (device_id, user_id)
);

CREATE TABLE reminder_deliveries (
  reminder_id TEXT NOT NULL REFERENCES reminders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (reminder_id, user_id)
);
