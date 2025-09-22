-- Check what types of donors person 126 has received from

-- Get all entity_type_ids for donations to person 126's campaigns
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.entity_type_id,
    et.entity_type_name,
    COUNT(*) as donation_count,
    SUM(t.amount) as total_amount
FROM cf_transactions t
LEFT JOIN cf_entity_types et ON et.entity_type_id = t.entity_type_id
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)  -- Income only
AND t.transaction_date BETWEEN '2017-10-15' AND '2018-05-05'
AND t.amount >= 100
GROUP BY t.entity_type_id, et.entity_type_name
ORDER BY donation_count DESC;

-- Show sample donations with their entity types
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 126
)
SELECT
    t.transaction_id,
    t.received_from_or_paid_to as donor_name,
    t.amount,
    t.transaction_date,
    t.entity_type_id,
    et.entity_type_name as donor_type
FROM cf_transactions t
LEFT JOIN cf_entity_types et ON et.entity_type_id = t.entity_type_id
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)
AND t.transaction_date BETWEEN '2017-10-15' AND '2018-05-05'
AND t.amount >= 100
ORDER BY t.amount DESC
LIMIT 20;