-- Quick script to link legislators to entities using exact name matches
-- This is a simpler approach that focuses on exact matches first

-- First, let's see what we're working with
SELECT 
  'Current state - Legislators without entities:' AS status,
  COUNT(*) AS legislators_without_entities
FROM mv_legislators_search
WHERE all_entity_ids IS NULL OR array_length(all_entity_ids, 1) = 0;

-- Create a function to extract last name from "Last, First" format
CREATE OR REPLACE FUNCTION extract_last_name(entity_name TEXT)
RETURNS TEXT AS $$
BEGIN
  IF entity_name LIKE '%,%' THEN
    RETURN TRIM(SPLIT_PART(entity_name, ',', 1));
  ELSE
    RETURN entity_name;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function to extract first name from "Last, First" format
CREATE OR REPLACE FUNCTION extract_first_name(entity_name TEXT)
RETURNS TEXT AS $$
BEGIN
  IF entity_name LIKE '%,%' THEN
    RETURN TRIM(SPLIT_PART(entity_name, ',', 2));
  ELSE
    RETURN '';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Find exact matches and insert them
WITH exact_matches AS (
  SELECT DISTINCT
    pl.person_id,
    cer.entity_id,
    l.full_name AS legislator_name,
    cer.entity_name,
    cer.committee_name,
    cer.candidate
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
    -- First Last format matches
    OR (cer.entity_name LIKE '%,%' AND 
        LOWER(l.full_name) = LOWER(
          TRIM(SPLIT_PART(cer.entity_name, ',', 1)) || ' ' || 
          TRIM(SPLIT_PART(cer.entity_name, ',', 2))
        ))
  )
  WHERE cer.entity_type LIKE '%Candidate%'
)
INSERT INTO rs_person_cf_entities (person_id, entity_id)
SELECT DISTINCT 
  em.person_id,
  em.entity_id
FROM exact_matches em
WHERE NOT EXISTS (
  SELECT 1 FROM rs_person_cf_entities pce 
  WHERE pce.person_id = em.person_id 
    AND pce.entity_id = em.entity_id
);

-- Show the exact matches we found
SELECT 
  'Exact matches found:' AS status,
  COUNT(*) AS total_exact_matches
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

-- Show some examples of the exact matches
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

-- Show final results
SELECT 
  'After exact matching - Legislators with entities:' AS status,
  COUNT(DISTINCT person_id) AS legislators_with_entities,
  COUNT(DISTINCT entity_id) AS unique_entities_linked
FROM mv_legislators_search
WHERE all_entity_ids IS NOT NULL 
  AND array_length(all_entity_ids, 1) > 0;

-- Clean up temporary functions
DROP FUNCTION IF EXISTS extract_last_name(TEXT);
DROP FUNCTION IF EXISTS extract_first_name(TEXT);


