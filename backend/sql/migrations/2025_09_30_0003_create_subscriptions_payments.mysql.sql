CREATE TABLE IF NOT EXISTS `subscriptions_payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `amount` INT NOT NULL,
  `currency` VARCHAR(10) NOT NULL,
  `phone` VARCHAR(32) NULL,
  `provider` VARCHAR(32) NOT NULL DEFAULT 'wave',
  `reference` VARCHAR(128) UNIQUE,
  `status` VARCHAR(32) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
