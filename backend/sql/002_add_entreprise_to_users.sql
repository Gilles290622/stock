-- Migration: add 'entreprise' column to users table (MySQL)
ALTER TABLE `users`
  ADD COLUMN `entreprise` VARCHAR(255) NULL AFTER `full_name`;

-- For SQLite (dev) you cannot directly add after position nor drop easily; use a simple ADD COLUMN:
-- ALTER TABLE users ADD COLUMN entreprise TEXT;

-- Rollback (manual):
-- ALTER TABLE `users` DROP COLUMN `entreprise`;