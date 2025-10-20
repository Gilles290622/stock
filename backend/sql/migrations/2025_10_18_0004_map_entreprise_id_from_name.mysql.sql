UPDATE `users` u
LEFT JOIN `stock_entreprise` e ON e.`name` = u.`entreprise`
SET u.`entreprise_id` = e.`id`
WHERE u.`entreprise_id` IS NULL;
