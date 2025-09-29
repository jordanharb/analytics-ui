-- Original bulk entity linking script
-- This script would have been used to initially populate rs_person_cf_entities
-- Based on patterns found in relink_missing_entities.sql and other linking scripts

-- Function to clean up name for matching (removes Jr., Sr., III, etc.)
CREATE OR REPLACE FUNCTION clean_name_for_matching(input_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            UPPER(TRIM(input_name)),
            '\s+(JR\.?|SR\.?|III|II|IV|V|VI|VII|VIII|IX|X)\.?\s*$', '', 'gi'
          ),
          '\.', '', 'g'
        ),
        ',\s*$', '', 'g'
      ),
      '\s+', ' ', 'g'
    ),
    '^\s+|\s+$', '', 'g'
  );
END;
$$ LANGUAGE plpgsql;

-- Original bulk linking logic - matches all people to entities
WITH all_people AS (
  SELECT
    p.person_id,
    p.display_name,
    clean_name_for_matching(p.display_name) as clean_name
  FROM rs_people p
  WHERE p.display_name IS NOT NULL
),
potential_matches AS (
  SELECT
    ap.person_id,
    ap.display_name,
    ap.clean_name,
    e.entity_id,
    e.primary_candidate_name,
    e.primary_committee_name,
    clean_name_for_matching(e.primary_candidate_name) as entity_clean_name,
    -- Calculate similarity score
    CASE
      WHEN clean_name_for_matching(e.primary_candidate_name) = ap.clean_name THEN 1.0
      WHEN clean_name_for_matching(e.primary_candidate_name) ILIKE '%' || ap.clean_name || '%' THEN 0.9
      WHEN ap.clean_name ILIKE '%' || clean_name_for_matching(e.primary_candidate_name) || '%' THEN 0.8
      ELSE similarity(clean_name_for_matching(e.primary_candidate_name), ap.clean_name)
    END as match_score
  FROM all_people ap
  CROSS JOIN cf_entities e
  WHERE e.primary_candidate_name IS NOT NULL
    AND LENGTH(e.primary_candidate_name) > 0
),
best_matches AS (
  SELECT DISTINCT ON (ap.person_id)
    ap.person_id,
    ap.display_name,
    e.entity_id,
    e.primary_candidate_name,
    CASE
      WHEN clean_name_for_matching(e.primary_candidate_name) = ap.clean_name THEN 1.0
      WHEN clean_name_for_matching(e.primary_candidate_name) ILIKE '%' || ap.clean_name || '%' THEN 0.9
      WHEN ap.clean_name ILIKE '%' || clean_name_for_matching(e.primary_candidate_name) || '%' THEN 0.8
      ELSE similarity(clean_name_for_matching(e.primary_candidate_name), ap.clean_name)
    END as match_score
  FROM all_people ap
  CROSS JOIN cf_entities e
  WHERE e.primary_candidate_name IS NOT NULL
    AND LENGTH(e.primary_candidate_name) > 0
    AND (
      clean_name_for_matching(e.primary_candidate_name) = ap.clean_name
      OR clean_name_for_matching(e.primary_candidate_name) ILIKE '%' || ap.clean_name || '%'
      OR ap.clean_name ILIKE '%' || clean_name_for_matching(e.primary_candidate_name) || '%'
      OR similarity(clean_name_for_matching(e.primary_candidate_name), ap.clean_name) >= 0.7
    )
  ORDER BY ap.person_id, match_score DESC
)
-- Insert the best matches
INSERT INTO rs_person_cf_entities (person_id, entity_id)
SELECT 
  person_id,
  entity_id
FROM best_matches
WHERE match_score >= 0.8  -- Only very high confidence for bulk insert
ON CONFLICT (person_id, entity_id) DO NOTHING;

-- Show results
SELECT 
  'Bulk linking completed:' AS status,
  COUNT(*) AS total_relationships
FROM rs_person_cf_entities;

-- Show some examples
SELECT 
  'Sample relationships created:' AS status,
  p.display_name,
  e.primary_candidate_name,
  e.primary_committee_name
FROM rs_person_cf_entities pce
JOIN rs_people p ON pce.person_id = p.person_id
JOIN cf_entities e ON pce.entity_id = e.entity_id
ORDER BY p.display_name
LIMIT 10;

-- Refresh materialized view
REFRESH MATERIALIZED VIEW mv_entities_search;

