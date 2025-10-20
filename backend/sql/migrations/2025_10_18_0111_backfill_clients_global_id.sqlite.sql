UPDATE stock_clients AS sc
SET global_id = (
  SELECT COALESCE(se.global_code, NULL)
  FROM users u
  LEFT JOIN stock_entreprise se ON se.id = u.entreprise_id
  WHERE u.id = sc.user_id
);