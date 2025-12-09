-- Quick script to link legislators to entities using simple exact matching
-- Run this first to get basic matches, then use the more sophisticated scripts

-- Check current state
SELECT 
  'BEFORE - Legislators without entities:' AS status,
  COUNT(*) AS count
FROM mv_legislators_search
WHERE all_entity_ids IS NULL OR array_length(all_entity_ids, 1) = 0;

-- Insert exact matches
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
  COUNT(*) AS count
FROM (
  SELECT DISTINCT pl.person_id, cer.entity_id
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
) matches;

-- Show some examples
SELECT 
  'Sample matches created:' AS status,
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

-- Show final results
SELECT 
  'FINAL - Legislators with entities:' AS status,
  COUNT(DISTINCT person_id) AS legislators_with_entities,
  COUNT(DISTINCT entity_id) AS unique_entities_linked
FROM mv_legislators_search
WHERE all_entity_ids IS NOT NULL 
  AND array_length(all_entity_ids, 1) > 0;

-- Show legislators still without entities
SELECT 
  'REMAINING - Legislators without entities:' AS status,
  COUNT(*) AS count
FROM mv_legislators_search
WHERE all_entity_ids IS NULL OR array_length(all_entity_ids, 1) = 0;


