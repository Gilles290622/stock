UPDATE stock_clients sc
JOIN users u ON u.id = sc.user_id
LEFT JOIN stock_entreprise se ON se.id = u.entreprise_id
SET sc.global_id = se.global_code;