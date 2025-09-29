-- Simple exact matching script - runs fast and won't timeout
-- This only does exact matches, no fuzzy matching

-- Check current state
SELECT 
  'BEFORE - Current relationships:' AS status,
  COUNT(*) AS total_relationships
FROM rs_person_cf_entities;

-- Insert exact matches only
INSERT INTO rs_person_cf_entities (person_id, entity_id)
SELECT DISTINCT 
  pl.person_id,
  cer.entity_id
FROM legislators l
JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
JOIN cf_entity_records cer ON (
  -- Direct name matches
  LOWER(l.full_name) = LOWER(cer.entity_name)
  OR LOWER(l.full_name) = LOWER(cer.candidate)
  OR LOWER(l.full_name) = LOWER(cer.committee_name)
  -- "Last, First" format matches
  OR (cer.entity_name LIKE '%,%' AND 
      LOWER(l.full_name) = LOWER(
        TRIM(SPLIT_PART(cer.entity_name, ',', 2)) || ' ' || 
        TRIM(SPLIT_PART(cer.entity_name, ',', 1))
      ))
)
WHERE cer.entity_type LIKE '%Candidate%'
  AND NOT EXISTS (
    SELECT 1 FROM rs_person_cf_entities pce 
    WHERE pce.person_id = pl.person_id 
      AND pce.entity_id = cer.entity_id
  );

-- Show what we found
SELECT 
  'AFTER - Exact matches inserted:' AS status,
  COUNT(*) AS total_relationships
FROM rs_person_cf_entities;

-- Show legislators with entities
SELECT 
  'Legislators with entities:' AS status,
  COUNT(DISTINCT person_id) AS legislators_with_entities
FROM rs_person_cf_entities pce
WHERE EXISTS (
  SELECT 1 FROM legislators l
  JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
  WHERE pl.person_id = pce.person_id
);

-- Show some examples
SELECT 
  'Sample exact matches:' AS status,
  l.full_name AS legislator_name,
  cer.entity_name,
  cer.committee_name,
  cer.candidate
FROM legislators l
JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
JOIN cf_entity_records cer ON (
  LOWER(l.full_name) = LOWER(cer.entity_name)
  OR LOWER(l.full_name) = LOWER(cer.candidate)
  OR LOWER(l.full_name) = LOWER(cer.committee_name)
  OR (cer.entity_name LIKE '%,%' AND 
      LOWER(l.full_name) = LOWER(
        TRIM(SPLIT_PART(cer.entity_name, ',', 2)) || ' ' || 
        TRIM(SPLIT_PART(cer.entity_name, ',', 1))
      ))
)
WHERE cer.entity_type LIKE '%Candidate%'
ORDER BY l.full_name
LIMIT 10;

-- Refresh the materialized view
REFRESH MATERIALIZED VIEW mv_legislators_search;

