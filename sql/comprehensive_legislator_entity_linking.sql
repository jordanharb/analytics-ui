-- Comprehensive script to link legislators to their campaign finance entities
-- This script handles exact matches, fuzzy matching, and manual overrides

-- First, let's check the current state
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

-- Create helper functions for name matching
CREATE OR REPLACE FUNCTION normalize_name(name_text TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        LOWER(COALESCE(name_text, '')),
        '\s+', ' ', 'g'
      ),
      '\s+(jr|sr|ii|iii|iv|v)\.?$', '', 'i'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function to reverse "Last, First" format
CREATE OR REPLACE FUNCTION reverse_name_format(name_text TEXT)
RETURNS TEXT AS $$
BEGIN
  IF name_text LIKE '%,%' THEN
    RETURN TRIM(SPLIT_PART(name_text, ',', 2)) || ' ' || TRIM(SPLIT_PART(name_text, ',', 1));
  ELSE
    RETURN name_text;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function to check if names are similar enough
CREATE OR REPLACE FUNCTION names_match(name1 TEXT, name2 TEXT, threshold FLOAT DEFAULT 0.8)
RETURNS BOOLEAN AS $$
DECLARE
  norm1 TEXT;
  norm2 TEXT;
  similarity_score FLOAT;
BEGIN
  norm1 := normalize_name(name1);
  norm2 := normalize_name(name2);
  
  -- Check exact match
  IF norm1 = norm2 THEN
    RETURN TRUE;
  END IF;
  
  -- Check if one contains the other
  IF norm1 LIKE '%' || norm2 || '%' OR norm2 LIKE '%' || norm1 || '%' THEN
    RETURN TRUE;
  END IF;
  
  -- Use similarity function if available
  BEGIN
    similarity_score := similarity(norm1, norm2);
    RETURN similarity_score >= threshold;
  EXCEPTION
    WHEN OTHERS THEN
      -- If similarity function is not available, fall back to basic matching
      RETURN FALSE;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a table to store manual overrides for difficult cases
CREATE TEMP TABLE manual_overrides (
  legislator_name TEXT,
  entity_name TEXT,
  entity_id INTEGER,
  reason TEXT
);

-- Insert some manual overrides for common variations
INSERT INTO manual_overrides (legislator_name, entity_name, entity_id, reason) VALUES
-- Add manual overrides here for cases that are hard to match automatically
-- Example: ('John Smith', 'Smith, John', 12345, 'Manual override for name format variation')
;

-- Find all potential matches
WITH legislator_entities AS (
  SELECT DISTINCT
    l.legislator_id,
    l.full_name AS legislator_name,
    p.person_id,
    p.display_name
  FROM legislators l
  JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
  JOIN rs_people p ON pl.person_id = p.person_id
),
entity_candidates AS (
  SELECT DISTINCT
    cer.entity_id,
    cer.entity_name,
    cer.entity_first_name,
    cer.committee_name,
    cer.candidate,
    cer.entity_type
  FROM cf_entity_records cer
  WHERE cer.entity_name IS NOT NULL
    AND cer.entity_name != ''
    AND cer.entity_type LIKE '%Candidate%'
),
potential_matches AS (
  SELECT 
    le.legislator_id,
    le.legislator_name,
    le.person_id,
    le.display_name,
    ec.entity_id,
    ec.entity_name,
    ec.committee_name,
    ec.candidate,
    -- Check various matching criteria
    CASE 
      WHEN LOWER(le.legislator_name) = LOWER(ec.entity_name) THEN 'exact_entity'
      WHEN LOWER(le.legislator_name) = LOWER(ec.candidate) THEN 'exact_candidate'
      WHEN LOWER(le.legislator_name) = LOWER(ec.committee_name) THEN 'exact_committee'
      WHEN LOWER(le.legislator_name) = LOWER(reverse_name_format(ec.entity_name)) THEN 'exact_reversed'
      WHEN names_match(le.legislator_name, ec.entity_name) THEN 'fuzzy_entity'
      WHEN names_match(le.legislator_name, ec.candidate) THEN 'fuzzy_candidate'
      WHEN names_match(le.legislator_name, ec.committee_name) THEN 'fuzzy_committee'
      WHEN names_match(le.legislator_name, reverse_name_format(ec.entity_name)) THEN 'fuzzy_reversed'
      ELSE NULL
    END AS match_type,
    -- Calculate confidence score
    CASE 
      WHEN LOWER(le.legislator_name) = LOWER(ec.entity_name) THEN 1.0
      WHEN LOWER(le.legislator_name) = LOWER(ec.candidate) THEN 1.0
      WHEN LOWER(le.legislator_name) = LOWER(ec.committee_name) THEN 1.0
      WHEN LOWER(le.legislator_name) = LOWER(reverse_name_format(ec.entity_name)) THEN 0.95
      WHEN names_match(le.legislator_name, ec.entity_name) THEN 0.9
      WHEN names_match(le.legislator_name, ec.candidate) THEN 0.9
      WHEN names_match(le.legislator_name, ec.committee_name) THEN 0.9
      WHEN names_match(le.legislator_name, reverse_name_format(ec.entity_name)) THEN 0.85
      ELSE 0.0
    END AS confidence_score
  FROM legislator_entities le
  CROSS JOIN entity_candidates ec
  WHERE 
    -- Only consider potential matches
    LOWER(le.legislator_name) = LOWER(ec.entity_name)
    OR LOWER(le.legislator_name) = LOWER(ec.candidate)
    OR LOWER(le.legislator_name) = LOWER(ec.committee_name)
    OR LOWER(le.legislator_name) = LOWER(reverse_name_format(ec.entity_name))
    OR names_match(le.legislator_name, ec.entity_name)
    OR names_match(le.legislator_name, ec.candidate)
    OR names_match(le.legislator_name, ec.committee_name)
    OR names_match(le.legislator_name, reverse_name_format(ec.entity_name))
),
ranked_matches AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY person_id, entity_id 
      ORDER BY confidence_score DESC
    ) AS rn
  FROM potential_matches
  WHERE match_type IS NOT NULL
),
best_matches AS (
  SELECT 
    legislator_id,
    legislator_name,
    person_id,
    display_name,
    entity_id,
    entity_name,
    committee_name,
    candidate,
    match_type,
    confidence_score
  FROM ranked_matches
  WHERE rn = 1
    AND confidence_score >= 0.8  -- Only high confidence matches
)
-- Insert the matches
INSERT INTO rs_person_cf_entities (person_id, entity_id)
SELECT DISTINCT 
  bm.person_id,
  bm.entity_id
FROM best_matches bm
WHERE NOT EXISTS (
  SELECT 1 FROM rs_person_cf_entities pce 
  WHERE pce.person_id = bm.person_id 
    AND pce.entity_id = bm.entity_id
);

-- Show results
SELECT 
  'Matches found and inserted:' AS status,
  COUNT(*) AS total_matches
FROM (
  SELECT DISTINCT person_id, entity_id
  FROM rs_person_cf_entities pce
  WHERE EXISTS (
    SELECT 1 FROM legislators l
    JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
    WHERE pl.person_id = pce.person_id
  )
) matches;

-- Show some examples
SELECT 
  'Sample matches:' AS status,
  l.full_name AS legislator_name,
  e.primary_committee_name,
  e.primary_candidate_name
FROM rs_person_cf_entities pce
JOIN rs_people p ON pce.person_id = p.person_id
JOIN legislators l ON l.legislator_id IN (
  SELECT pl.legislator_id FROM rs_person_legislators pl WHERE pl.person_id = pce.person_id
)
JOIN cf_entities e ON pce.entity_id = e.entity_id
ORDER BY l.full_name
LIMIT 10;

-- Refresh the materialized view
REFRESH MATERIALIZED VIEW mv_legislators_search;

-- Show final results
SELECT 
  'Final results - Legislators with entities:' AS status,
  COUNT(DISTINCT person_id) AS legislators_with_entities,
  COUNT(DISTINCT entity_id) AS unique_entities_linked
FROM mv_legislators_search
WHERE all_entity_ids IS NOT NULL 
  AND array_length(all_entity_ids, 1) > 0;

-- Show legislators still without entities
SELECT 
  'Legislators still without entities:' AS status,
  COUNT(*) AS count
FROM mv_legislators_search
WHERE all_entity_ids IS NULL OR array_length(all_entity_ids, 1) = 0;

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

-- Clean up
DROP FUNCTION IF EXISTS normalize_name(TEXT);
DROP FUNCTION IF EXISTS reverse_name_format(TEXT);
DROP FUNCTION IF EXISTS names_match(TEXT, TEXT, FLOAT);


