UPDATE stock_mouvements sm
JOIN users u ON u.id = sm.user_id
LEFT JOIN stock_entreprise se ON se.id = u.entreprise_id
SET sm.global_id = se.global_code;