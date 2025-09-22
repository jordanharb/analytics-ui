-- Debug donations query with proper schema

-- 1. Check if person has CF entities
SELECT
    p.person_id,
    p.display_name,
    COUNT(pce.entity_id) as entity_count
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
WHERE p.person_id = 180
GROUP BY p.person_id, p.display_name;

-- 2. List the CF entities for the person
SELECT
    pce.person_id,
    pce.entity_id,
    e.primary_committee_name,
    e.primary_candidate_name
FROM rs_person_cf_entities pce
JOIN cf_entities e ON e.entity_id = pce.entity_id
WHERE pce.person_id = 180;

-- 3. Check transaction counts by disposition
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 180
)
SELECT
    t.transaction_type_disposition_id,
    COUNT(*) as count,
    SUM(t.amount) as total_amount
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
GROUP BY t.transaction_type_disposition_id
ORDER BY count DESC;

-- 4. Check income transactions (disposition 1 or 2)
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 180
)
SELECT COUNT(*) as income_count
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2);

-- 5. Sample of income transactions over $100
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 180
)
SELECT
    t.transaction_id,
    t.entity_id,
    t.received_from_or_paid_to,
    t.amount,
    t.transaction_date,
    t.entity_type_id,
    t.transaction_type_disposition_id
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)
AND t.amount >= 100
ORDER BY t.amount DESC
LIMIT 20;

-- 6. Check date ranges of transactions
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 180
)
SELECT
    MIN(transaction_date) as earliest,
    MAX(transaction_date) as latest,
    COUNT(*) as total
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)
AND t.amount >= 100;