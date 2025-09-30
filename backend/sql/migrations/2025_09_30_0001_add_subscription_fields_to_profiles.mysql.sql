-- Add subscription fields to profiles (MySQL)
ALTER TABLE `profiles`
  ADD COLUMN `subscription_expires` DATETIME NULL AFTER `status`,
  ADD COLUMN `free_days` INT NOT NULL DEFAULT 0 AFTER `subscription_expires`;
