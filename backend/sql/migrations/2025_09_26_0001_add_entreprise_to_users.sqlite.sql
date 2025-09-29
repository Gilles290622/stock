-- SQLite migration: add 'entreprise' column to users table if it doesn't exist
-- SQLite doesn't support IF NOT EXISTS for columns; try-add and ignore if exists
ALTER TABLE users ADD COLUMN entreprise TEXT;
