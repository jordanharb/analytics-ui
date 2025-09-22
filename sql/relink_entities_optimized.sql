
-- Optimized script to relink missing entities - runs faster to avoid timeouts

-- First, create the name cleaning function if it doesn't exist
CREATE OR REPLACE FUNCTION clean_name_for_matching(input_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            UPPER(TRIM(COALESCE(input_name, ''))),
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
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 1: Just check who needs relinking (fast query)
SELECT
  p.person_id,
  p.display_name,
  COUNT(pce.entity_id) as entity_count
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
GROUP BY p.person_id, p.display_name
HAVING COUNT(pce.entity_id) = 0
ORDER BY p.display_name
LIMIT 50;

-- Step 2: Fix specific person - Daniel Hernandez Jr. (person_id 126)
WITH hernandez_entities AS (
  SELECT
    entity_id,
    primary_candidate_name,
    primary_committee_name
  FROM cf_entities
  WHERE primary_candidate_name ILIKE '%hernandez%daniel%'
     OR primary_candidate_name ILIKE '%daniel%hernandez%'
  LIMIT 5
)
SELECT * FROM hernandez_entities;

-- Step 3: Insert the correct entity for Daniel Hernandez Jr.
-- First, verify the entity_id from the query above, then uncomment and run:
-- INSERT INTO rs_person_cf_entities (person_id, entity_id)
-- VALUES (126, [ENTITY_ID_FROM_ABOVE])
-- ON CONFLICT DO NOTHING;

-- Step 4: Process a small batch of people at a time to avoid timeout
-- This processes only 10 people at a time
WITH missing_batch AS (
  SELECT
    p.person_id,
    p.display_name,
    clean_name_for_matching(p.display_name) as clean_name
  FROM rs_people p
  LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
  WHERE pce.entity_id IS NULL
    AND p.display_name IS NOT NULL
  GROUP BY p.person_id, p.display_name
  LIMIT 10
),
matches AS (
  SELECT
    mb.person_id,
    mb.display_name,
    mb.clean_name,
    e.entity_id,
    e.primary_candidate_name,
    clean_name_for_matching(e.primary_candidate_name) as entity_clean_name
  FROM missing_batch mb
  JOIN cf_entities e ON
    e.primary_candidate_name IS NOT NULL
    AND (
      -- Use more efficient matching with indexed operations
      e.primary_candidate_name ILIKE '%' || SPLIT_PART(mb.clean_name, ' ', -1) || '%'
      AND e.primary_candidate_name ILIKE '%' || SPLIT_PART(mb.clean_name, ' ', 1) || '%'
    )
)
SELECT
  m.person_id,
  m.display_name,
  m.entity_id,
  m.primary_candidate_name,
  CASE
    WHEN m.clean_name = m.entity_clean_name THEN 'EXACT'
    WHEN m.entity_clean_name ILIKE '%' || m.clean_name || '%' THEN 'CONTAINS'
    ELSE 'PARTIAL'
  END as match_type
FROM matches m
ORDER BY m.person_id, match_type;

-- Step 5: Generate INSERT statements for a specific person
-- Replace PERSON_ID with actual ID (e.g., 126)
WITH person_search AS (
  SELECT
    126 as person_id,
    'Daniel Hernandez, Jr.' as display_name,
    clean_name_for_matching('Daniel Hernandez, Jr.') as clean_name
),
entity_matches AS (
  SELECT
    ps.person_id,
    ps.display_name,
    e.entity_id,
    e.primary_candidate_name,
    e.primary_committee_name
  FROM person_search ps
  CROSS JOIN cf_entities e
  WHERE e.primary_candidate_name IS NOT NULL
    AND (
      e.primary_candidate_name ILIKE '%' || SPLIT_PART(ps.clean_name, ' ', 1) || '%'
      AND e.primary_candidate_name ILIKE '%' || SPLIT_PART(ps.clean_name, ' ', 2) || '%'
    )
  LIMIT 10
)
SELECT
  entity_id,
  primary_candidate_name,
  primary_committee_name,
  'INSERT INTO rs_person_cf_entities (person_id, entity_id) VALUES (' ||
  person_id || ', ' || entity_id || ') ON CONFLICT DO NOTHING;' as insert_sql
FROM entity_matches;

-- Step 6: After inserting, verify the fix worked
SELECT
  p.person_id,
  p.display_name,
  COUNT(pce.entity_id) as entity_count,
  ARRAY_AGG(pce.entity_id) as entity_ids
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
WHERE p.person_id = 126
GROUP BY p.person_id, p.display_name;

-- Step 7: Refresh the materialized view after all inserts
-- REFRESH MATERIALIZED VIEW mv_entities_search;