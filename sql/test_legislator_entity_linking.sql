-- Test script to check legislator-entity linking
-- Run this to see the current state and test the linking

-- Check current state
SELECT 
  'Current state - Total legislators:' AS status,
  COUNT(*) AS total_legislators
FROM legislators;

SELECT 
  'Current state - Legislators with entities:' AS status,
  COUNT(DISTINCT person_id) AS legislators_with_entities
FROM mv_legislators_search
WHERE all_entity_ids IS NOT NULL 
  AND array_length(all_entity_ids, 1) > 0;

-- Show some examples of legislators without entities
SELECT 
  'Sample legislators without entities:' AS status,
  display_name,
  legislator_name,
  party,
  body,
  district
FROM mv_legislators_search
WHERE all_entity_ids IS NULL OR array_length(all_entity_ids, 1) = 0
ORDER BY display_name
LIMIT 10;

-- Check for potential matches in the entity records
SELECT 
  'Potential entity matches for legislators:' AS status,
  COUNT(*) AS potential_matches
FROM (
  SELECT DISTINCT
    l.full_name AS legislator_name,
    cer.entity_name,
    cer.committee_name,
    cer.candidate
  FROM legislators l
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

-- Show some examples of potential matches
SELECT 
  'Sample potential matches:' AS status,
  l.full_name AS legislator_name,
  cer.entity_name,
  cer.committee_name,
  cer.candidate,
  cer.entity_type
FROM legislators l
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

