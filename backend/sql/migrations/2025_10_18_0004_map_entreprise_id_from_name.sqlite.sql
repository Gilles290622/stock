UPDATE users SET entreprise_id = (
  SELECT id FROM stock_entreprise e WHERE e.name = users.entreprise
)
WHERE entreprise IS NOT NULL AND entreprise <> '' AND (entreprise_id IS NULL OR entreprise_id = 0);
