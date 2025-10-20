UPDATE stock_paiements sp
JOIN users u ON u.id = sp.user_id
LEFT JOIN stock_entreprise se ON se.id = u.entreprise_id
SET sp.global_id = se.global_code;