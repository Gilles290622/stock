UPDATE stock_depenses sd
JOIN users u ON u.id = sd.user_id
LEFT JOIN stock_entreprise se ON se.id = u.entreprise_id
SET sd.global_id = se.global_code;