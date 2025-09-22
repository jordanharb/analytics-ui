-- Query to see what entity types exist in the database
-- Run this to understand what types to filter for political donations

-- Check entity types table
SELECT DISTINCT
  entity_type_id,
  entity_type_name,
  entity_category
FROM cf_entity_types
ORDER BY entity_category, entity_type_name;

-- Also check what entity types are actually used in the records
SELECT DISTINCT
  er.entity_type,
  COUNT(*) as count
FROM cf_entity_records er
WHERE er.entity_type IS NOT NULL
GROUP BY er.entity_type
ORDER BY count DESC;

-- Sample of actual donation data to see patterns
SELECT DISTINCT
  d.donation_type,
  d.is_pac,
  d.is_corporate,
  COUNT(*) as count
FROM cf_donations d
WHERE d.donation_amt >= 100
GROUP BY d.donation_type, d.is_pac, d.is_corporate
ORDER BY count DESC
LIMIT 20;