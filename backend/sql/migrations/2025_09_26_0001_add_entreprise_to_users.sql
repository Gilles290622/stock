-- Add entreprise column to users if not exists (idempotent guard)
ALTER TABLE `users`
  ADD COLUMN `entreprise` VARCHAR(255) NULL AFTER `full_name`;
