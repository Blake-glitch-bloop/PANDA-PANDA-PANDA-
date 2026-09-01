CREATE TABLE IF NOT EXISTS app_state (
  user_key TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
