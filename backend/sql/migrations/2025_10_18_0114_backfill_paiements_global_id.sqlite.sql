UPDATE stock_paiements AS sp
SET global_id = (
  SELECT COALESCE(se.global_code, NULL)
  FROM users u
  LEFT JOIN stock_entreprise se ON se.id = u.entreprise_id
  WHERE u.id = sp.user_id
);