-- Check what entity_type_id 10 is
SELECT * FROM cf_entity_types WHERE entity_type_id = 10;

-- Check all entity types to understand the schema
SELECT * FROM cf_entity_types ORDER BY entity_type_id;

-- Check the distribution of entity_type_id in transactions for person 58
WITH person_entities AS (
    SELECT entity_id FROM rs_person_cf_entities WHERE person_id = 58
)
SELECT
    t.entity_type_id,
    et.entity_type_name,
    et.entity_category,
    COUNT(*) as count,
    SUM(t.amount) as total_amount
FROM cf_transactions t
LEFT JOIN cf_entity_types et ON et.entity_type_id = t.entity_type_id
WHERE t.entity_id IN (SELECT entity_id FROM person_entities)
AND t.transaction_type_disposition_id IN (1, 2)  -- Income only
GROUP BY t.entity_type_id, et.entity_type_name, et.entity_category
ORDER BY count DESC;