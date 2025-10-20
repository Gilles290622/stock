INSERT INTO stock_entreprise (`name`)
SELECT DISTINCT `entreprise` FROM `users`
WHERE `entreprise` IS NOT NULL AND `entreprise` <> ''
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
