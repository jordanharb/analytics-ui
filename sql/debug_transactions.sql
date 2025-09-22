-- Check the structure of transactions to understand the flow
-- First, let's see a sample of transactions
SELECT
  t.transaction_id,
  t.entity_id,
  t.committee_id,
  t.committee_name,
  t.received_from_or_paid_to,
  t.transaction_type,
  t.transaction_type_disposition_id,
  t.amount,
  t.transaction_date
FROM cf_transactions t
WHERE t.transaction_type_disposition_id IN (1, 2)
LIMIT 10;

-- Now check if any committees match our person's entities
SELECT
  p.display_name,
  pce.entity_id,
  e.primary_candidate_name,
  e.primary_committee_name,
  COUNT(t.transaction_id) as donation_count
FROM rs_people p
JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
JOIN cf_entities e ON pce.entity_id = e.entity_id
LEFT JOIN cf_transactions t ON t.committee_id = pce.entity_id
  AND t.transaction_type_disposition_id IN (1, 2)
WHERE p.display_name LIKE '%Hernandez%'
GROUP BY p.person_id, p.display_name, pce.entity_id, e.primary_candidate_name, e.primary_committee_name;