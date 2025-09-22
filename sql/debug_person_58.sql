-- Debug person_id 58 specifically

-- 1. Check if person 58 has CF entities
SELECT
    p.person_id,
    p.display_name,
    pce.entity_id
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
WHERE p.person_id = 58;

-- 2. Check what entities exist for person 58
SELECT
    pce.person_id,
    pce.entity_id,
    e.entity_id as e_entity_id,
    e.primary_committee_name,
    e.primary_candidate_name
FROM rs_person_cf_entities pce
LEFT JOIN cf_entities e ON e.entity_id = pce.entity_id
WHERE pce.person_id = 58;

-- 3. Check if any of those entity_ids have transactions
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 58
)
SELECT
    pe.entity_id,
    COUNT(t.transaction_id) as transaction_count
FROM person_entities pe
LEFT JOIN cf_transactions t ON t.entity_id = pe.entity_id
GROUP BY pe.entity_id;

-- 4. Check if the entity_ids match between tables
SELECT
    'rs_person_cf_entities' as source,
    COUNT(DISTINCT entity_id) as entity_count,
    MIN(entity_id) as min_id,
    MAX(entity_id) as max_id
FROM rs_person_cf_entities
WHERE person_id = 58
UNION ALL
SELECT
    'cf_transactions for those entities' as source,
    COUNT(DISTINCT t.entity_id) as entity_count,
    MIN(t.entity_id) as min_id,
    MAX(t.entity_id) as max_id
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 58);

-- 5. Check if there's ANY transaction data for the entities
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 58
)
SELECT COUNT(*) as total_transactions
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities);

-- 6. Sample transactions without any filters
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 58
)
SELECT
    t.transaction_id,
    t.entity_id,
    t.received_from_or_paid_to,
    t.amount,
    t.transaction_date,
    t.transaction_type_disposition_id,
    t.entity_type_id
FROM cf_transactions t
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
LIMIT 10;