-- Debug: Check if Daniel Hernandez Jr has campaign finance entities linked
-- First find the person_id
SELECT person_id, display_name
FROM rs_people
WHERE display_name LIKE '%Hernandez%';

-- Check if this person has any CF entities
SELECT
  p.person_id,
  p.display_name,
  pce.entity_id,
  e.primary_candidate_name,
  e.primary_committee_name
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
LEFT JOIN cf_entities e ON pce.entity_id = e.entity_id
WHERE p.display_name LIKE '%Hernandez%';

-- Check if there are any transactions for these entities
SELECT
  p.display_name,
  COUNT(DISTINCT t.transaction_id) as transaction_count,
  MIN(t.transaction_date) as earliest,
  MAX(t.transaction_date) as latest
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
LEFT JOIN cf_transactions t ON pce.entity_id = t.entity_id
WHERE p.display_name LIKE '%Hernandez%'
  AND t.transaction_type_disposition_id IN (1, 2)
GROUP BY p.person_id, p.display_name;