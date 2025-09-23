-- SQLite schema equivalent to 001_init.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  phone_number TEXT NULL,
  logo TEXT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_designations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  current_stock INTEGER NOT NULL DEFAULT 0,
  categorie INTEGER NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (categorie) REFERENCES stock_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS stock_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NULL,
  address TEXT NULL,
  phone TEXT NULL,
  email TEXT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_mouvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL, -- store as 'YYYY-MM-DD'
  type TEXT NOT NULL,
  designation_id INTEGER NULL,
  quantite INTEGER NOT NULL,
  prix INTEGER NOT NULL DEFAULT 0,
  montant INTEGER GENERATED ALWAYS AS (quantite * prix) STORED,
  client_id INTEGER NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  stockR INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (designation_id) REFERENCES stock_designations(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES stock_clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_paiements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mouvement_id INTEGER NOT NULL,
  user_id INTEGER NULL,
  montant NUMERIC NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (mouvement_id) REFERENCES stock_mouvements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_depenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  libelle TEXT NOT NULL,
  montant NUMERIC NOT NULL,
  destinataire TEXT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
