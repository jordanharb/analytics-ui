-- Script to link legislators to their campaign finance entities
-- This script matches legislator names with entity names using fuzzy matching
-- and populates the rs_person_cf_entities table

-- First, let's create a function to normalize names for better matching
CREATE OR REPLACE FUNCTION normalize_name_for_matching(name_text TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Convert to lowercase, remove extra spaces, and common suffixes
  RETURN TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        LOWER(COALESCE(name_text, '')),
        '\s+', ' ', 'g'  -- Replace multiple spaces with single space
      ),
      '\s+(jr|sr|ii|iii|iv|v)\.?$', '', 'i'  -- Remove common suffixes
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function to calculate name similarity
CREATE OR REPLACE FUNCTION calculate_name_similarity(name1 TEXT, name2 TEXT)
RETURNS FLOAT AS $$
DECLARE
  norm1 TEXT;
  norm2 TEXT;
  similarity_score FLOAT;
BEGIN
  norm1 := normalize_name_for_matching(name1);
  norm2 := normalize_name_for_matching(name2);
  
  -- Use PostgreSQL's similarity function (requires pg_trgm extension)
  similarity_score := similarity(norm1, norm2);
  
  -- Also check if one name contains the other (for partial matches)
  IF norm1 LIKE '%' || norm2 || '%' OR norm2 LIKE '%' || norm1 || '%' THEN
    similarity_score := GREATEST(similarity_score, 0.8);
  END IF;
  
  RETURN similarity_score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a temporary table to store potential matches
CREATE TEMP TABLE potential_matches AS
WITH legislator_entities AS (
  SELECT DISTINCT
    l.legislator_id,
    l.full_name AS legislator_name,
    p.person_id,
    p.display_name,
    p.name_key
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
    -- Create various name combinations for matching
    COALESCE(cer.entity_name, '') AS entity_name_clean,
    COALESCE(cer.entity_first_name, '') AS entity_first_name_clean,
    COALESCE(cer.candidate, '') AS candidate_clean,
    COALESCE(cer.committee_name, '') AS committee_name_clean
  FROM cf_entity_records cer
  WHERE cer.entity_name IS NOT NULL
    AND cer.entity_name != ''
    AND cer.entity_type LIKE '%Candidate%'
)
SELECT 
  le.legislator_id,
  le.legislator_name,
  le.person_id,
  le.display_name,
  le.name_key,
  ec.entity_id,
  ec.entity_name,
  ec.entity_first_name,
  ec.committee_name,
  ec.candidate,
  -- Calculate similarity scores for different name combinations
  calculate_name_similarity(le.legislator_name, ec.entity_name) AS entity_name_similarity,
  calculate_name_similarity(le.legislator_name, ec.candidate) AS candidate_similarity,
  calculate_name_similarity(le.legislator_name, ec.committee_name) AS committee_similarity,
  -- Check for exact matches in different formats
  CASE 
    WHEN LOWER(le.legislator_name) = LOWER(ec.entity_name) THEN 1.0
    WHEN LOWER(le.legislator_name) = LOWER(ec.candidate) THEN 1.0
    WHEN LOWER(le.legislator_name) = LOWER(ec.committee_name) THEN 1.0
    ELSE 0.0
  END AS exact_match,
  -- Check for "Last, First" format matches
  CASE 
    WHEN ec.entity_name LIKE '%,%' THEN
      calculate_name_similarity(
        le.legislator_name, 
        SPLIT_PART(ec.entity_name, ',', 2) || ' ' || SPLIT_PART(ec.entity_name, ',', 1)
      )
    ELSE 0.0
  END AS last_first_similarity
FROM legislator_entities le
CROSS JOIN entity_candidates ec
WHERE 
  -- Only consider potential matches with some similarity
  (
    calculate_name_similarity(le.legislator_name, ec.entity_name) > 0.3
    OR calculate_name_similarity(le.legislator_name, ec.candidate) > 0.3
    OR calculate_name_similarity(le.legislator_name, ec.committee_name) > 0.3
    OR LOWER(le.legislator_name) = LOWER(ec.entity_name)
    OR LOWER(le.legislator_name) = LOWER(ec.candidate)
    OR LOWER(le.legislator_name) = LOWER(ec.committee_name)
    OR (ec.entity_name LIKE '%,%' AND 
        calculate_name_similarity(
          le.legislator_name, 
          SPLIT_PART(ec.entity_name, ',', 2) || ' ' || SPLIT_PART(ec.entity_name, ',', 1)
        ) > 0.3)
  );

-- Create a table to store the best matches
CREATE TEMP TABLE best_matches AS
WITH ranked_matches AS (
  SELECT 
    *,
    GREATEST(
      entity_name_similarity,
      candidate_similarity,
      committee_similarity,
      exact_match,
      last_first_similarity
    ) AS best_similarity,
    ROW_NUMBER() OVER (
      PARTITION BY person_id, entity_id 
      ORDER BY GREATEST(
        entity_name_similarity,
        candidate_similarity,
        committee_similarity,
        exact_match,
        last_first_similarity
      ) DESC
    ) AS rn
  FROM potential_matches
)
SELECT 
  legislator_id,
  legislator_name,
  person_id,
  display_name,
  name_key,
  entity_id,
  entity_name,
  entity_first_name,
  committee_name,
  candidate,
  best_similarity,
  CASE 
    WHEN best_similarity >= 0.8 THEN 'high_confidence'
    WHEN best_similarity >= 0.6 THEN 'medium_confidence'
    WHEN best_similarity >= 0.4 THEN 'low_confidence'
    ELSE 'very_low_confidence'
  END AS confidence_level
FROM ranked_matches
WHERE rn = 1
  AND best_similarity >= 0.4;  -- Only include matches with at least 40% similarity

-- Show the matches before inserting
SELECT 
  'BEFORE INSERT - Potential matches found:' AS status,
  COUNT(*) AS total_matches,
  COUNT(CASE WHEN confidence_level = 'high_confidence' THEN 1 END) AS high_confidence,
  COUNT(CASE WHEN confidence_level = 'medium_confidence' THEN 1 END) AS medium_confidence,
  COUNT(CASE WHEN confidence_level = 'low_confidence' THEN 1 END) AS low_confidence,
  COUNT(CASE WHEN confidence_level = 'very_low_confidence' THEN 1 END) AS very_low_confidence
FROM best_matches;

-- Show some examples of the matches
SELECT 
  'Sample matches:' AS status,
  legislator_name,
  entity_name,
  committee_name,
  best_similarity,
  confidence_level
FROM best_matches
ORDER BY best_similarity DESC
LIMIT 10;

-- Insert the matches into rs_person_cf_entities
-- Only insert if the relationship doesn't already exist
INSERT INTO rs_person_cf_entities (person_id, entity_id)
SELECT DISTINCT 
  bm.person_id,
  bm.entity_id
FROM best_matches bm
WHERE NOT EXISTS (
  SELECT 1 FROM rs_person_cf_entities pce 
  WHERE pce.person_id = bm.person_id 
    AND pce.entity_id = bm.entity_id
)
AND bm.best_similarity >= 0.6;  -- Only insert high and medium confidence matches

-- Show results after insertion
SELECT 
  'AFTER INSERT - Relationships created:' AS status,
  COUNT(*) AS new_relationships
FROM rs_person_cf_entities pce
WHERE EXISTS (
  SELECT 1 FROM best_matches bm 
  WHERE bm.person_id = pce.person_id 
    AND bm.entity_id = pce.entity_id
);

-- Show some examples of the created relationships
SELECT 
  'Sample created relationships:' AS status,
  p.display_name,
  l.full_name AS legislator_name,
  e.primary_committee_name,
  e.primary_candidate_name
FROM rs_person_cf_entities pce
JOIN rs_people p ON pce.person_id = p.person_id
JOIN legislators l ON l.legislator_id IN (
  SELECT pl.legislator_id FROM rs_person_legislators pl WHERE pl.person_id = pce.person_id
)
JOIN cf_entities e ON pce.entity_id = e.entity_id
WHERE EXISTS (
  SELECT 1 FROM best_matches bm 
  WHERE bm.person_id = pce.person_id 
    AND bm.entity_id = pce.entity_id
)
ORDER BY p.display_name
LIMIT 10;

-- Refresh the materialized view to reflect the new relationships
REFRESH MATERIALIZED VIEW mv_legislators_search;

-- Show final results
SELECT 
  'FINAL RESULTS - Legislators with linked entities:' AS status,
  COUNT(DISTINCT person_id) AS legislators_with_entities,
  COUNT(DISTINCT entity_id) AS unique_entities_linked
FROM mv_legislators_search
WHERE all_entity_ids IS NOT NULL 
  AND array_length(all_entity_ids, 1) > 0;

-- Clean up temporary functions
DROP FUNCTION IF EXISTS normalize_name_for_matching(TEXT);
DROP FUNCTION IF EXISTS calculate_name_similarity(TEXT, TEXT);


