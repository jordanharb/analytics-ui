-- Test the donations query to debug why it returns 0 results

-- First, let's check if the person has any campaign finance entities
SELECT
    pce.person_id,
    pce.entity_id,
    pce.entity_name
FROM rs_person_cf_entities pce
WHERE pce.person_id = 180  -- Example person_id
LIMIT 10;

-- Check if there are any transactions for these entities
WITH person_entities AS (
    SELECT DISTINCT entity_id
    FROM rs_person_cf_entities
    WHERE person_id = 180
)
SELECT
    COUNT(*) as total_transactions,
    MIN(transaction_date) as earliest_date,
    MAX(transaction_date) as latest_date,
    COUNT(DISTINCT entity_id) as distinct_entities
FROM cf_transactions
WHERE entity_id IN (SELECT entity_id FROM person_entities);

-- Check transaction dispositions in the data
SELECT
    transaction_type_disposition_id,
    COUNT(*) as count
FROM cf_transactions
WHERE entity_id IN (
    SELECT DISTINCT entity_id
    FROM rs_person_cf_entities
    WHERE person_id = 180
)
GROUP BY transaction_type_disposition_id
ORDER BY count DESC;

-- Check entity types in the data
SELECT
    entity_type_id,
    COUNT(*) as count
FROM cf_transactions
WHERE entity_id IN (
    SELECT DISTINCT entity_id
    FROM rs_person_cf_entities
    WHERE person_id = 180
)
AND transaction_type_disposition_id IN (1, 2)
AND amount >= 100
GROUP BY entity_type_id
ORDER BY count DESC;

-- Sample of actual transactions
SELECT
    transaction_id,
    entity_id,
    entity_type_id,
    received_from_or_paid_to,
    transaction_date,
    amount,
    transaction_type_disposition_id
FROM cf_transactions
WHERE entity_id IN (
    SELECT DISTINCT entity_id
    FROM rs_person_cf_entities
    WHERE person_id = 180
)
AND transaction_type_disposition_id IN (1, 2)
AND amount >= 100
ORDER BY amount DESC
LIMIT 20;

-- Test the actual function
SELECT * FROM get_legislator_donations(180, '2023-01-01', '2024-12-31') LIMIT 10;