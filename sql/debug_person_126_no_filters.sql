-- Debug person_id 126 with NO filters to see what's actually there

-- 1. Check if person 126 has CF entities
SELECT
    p.person_id,
    p.display_name,
    COUNT(pce.entity_id) as entity_count,
    ARRAY_AGG(pce.entity_id) as entity_ids
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
WHERE p.person_id = 126
GROUP BY p.person_id, p.display_name;

-- 2. Get ALL transactions for person 126's entities with NO filters
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.transaction_id,
    t.entity_id,
    t.transaction_date,
    t.amount,
    t.transaction_type_disposition_id,
    t.transaction_entity_type_id,
    t.transaction_first_name,
    t.transaction_last_name,
    t.received_from_or_paid_to,
    t.transaction_occupation
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
ORDER BY t.transaction_date DESC
LIMIT 50;

-- 3. Check date ranges of ALL transactions
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    MIN(transaction_date) as earliest,
    MAX(transaction_date) as latest,
    COUNT(*) as total_transactions
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities);

-- 4. Check transactions in the specific date range with NO other filters
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    COUNT(*) as transactions_in_range
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_date BETWEEN '2021-10-04' AND '2022-10-03';

-- 5. Check transactions by disposition in date range
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.transaction_type_disposition_id,
    COUNT(*) as count
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_date BETWEEN '2021-10-04' AND '2022-10-03'
GROUP BY t.transaction_type_disposition_id
ORDER BY count DESC;

-- 6. Check INCOME transactions (disposition = 1) in date range
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    COUNT(*) as income_transactions
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_date BETWEEN '2021-10-04' AND '2022-10-03'
AND t.transaction_type_disposition_id = 1;

-- 7. Check income over $100 in date range
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    COUNT(*) as income_over_100
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_date BETWEEN '2021-10-04' AND '2022-10-03'
AND t.transaction_type_disposition_id = 1
AND t.amount >= 100;

-- 8. Show sample of income over $100 with entity types
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.transaction_id,
    t.entity_id,
    t.transaction_date,
    t.amount,
    t.transaction_entity_type_id,
    t.transaction_first_name,
    t.transaction_last_name,
    t.transaction_occupation,
    t.transaction_type_disposition_id
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_date BETWEEN '2021-10-04' AND '2022-10-03'
AND t.transaction_type_disposition_id = 1
AND t.amount >= 100
ORDER BY t.amount DESC
LIMIT 20;

-- 9. Check what entity types exist for income over $100
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.transaction_entity_type_id,
    COUNT(*) as count
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_date BETWEEN '2021-10-04' AND '2022-10-03'
AND t.transaction_type_disposition_id = 1
AND t.amount >= 100
GROUP BY t.transaction_entity_type_id
ORDER BY count DESC;

-- 10. Test the actual function
SELECT * FROM get_legislator_donations(126, '2021-10-04', '2022-10-03') LIMIT 20;