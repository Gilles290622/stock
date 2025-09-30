CREATE TABLE IF NOT EXISTS subscriptions_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  phone TEXT NULL,
  provider TEXT NOT NULL DEFAULT 'wave',
  reference TEXT UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
