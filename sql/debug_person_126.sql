-- Debug person_id 126 specifically

-- 1. Check if person 126 exists and has CF entities
SELECT
    p.person_id,
    p.display_name,
    COUNT(pce.entity_id) as entity_count
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
WHERE p.person_id = 126
GROUP BY p.person_id, p.display_name;

-- 2. List all CF entities for person 126
SELECT
    pce.person_id,
    pce.entity_id,
    e.primary_committee_name,
    e.primary_candidate_name,
    e.earliest_activity,
    e.latest_activity
FROM rs_person_cf_entities pce
JOIN cf_entities e ON e.entity_id = pce.entity_id
WHERE pce.person_id = 126;

-- 3. Check if these entities have ANY transactions at all
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    COUNT(*) as total_transactions,
    MIN(transaction_date) as earliest,
    MAX(transaction_date) as latest
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities);

-- 4. Check transactions in the specific date range
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    COUNT(*) as transactions_in_range
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)
AND t.transaction_date BETWEEN '2017-10-15' AND '2018-05-05'
AND t.amount >= 100;

-- 5. Check what entity types are being filtered
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.entity_type_id,
    COUNT(*) as count
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)
AND t.transaction_date BETWEEN '2017-10-15' AND '2018-05-05'
AND t.amount >= 100
GROUP BY t.entity_type_id
ORDER BY count DESC;

-- 6. Show sample transactions without entity_type_id filter
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.transaction_id,
    t.entity_id,
    t.entity_type_id,
    t.received_from_or_paid_to,
    t.amount,
    t.transaction_date,
    t.transaction_type_disposition_id
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)
AND t.transaction_date BETWEEN '2017-10-15' AND '2018-05-05'
AND t.amount >= 100
ORDER BY t.amount DESC
LIMIT 20;

-- 7. Test the actual function call
SELECT * FROM get_legislator_donations(126, '2017-10-15', '2018-05-05');