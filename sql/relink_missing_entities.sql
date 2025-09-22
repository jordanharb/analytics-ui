-- Script to relink missing entities for people with 0 entity_ids after deduplication

-- First, let's see which people have no entities linked
WITH missing_entities AS (
  SELECT
    p.person_id,
    p.display_name,
    p.name_key
  FROM rs_people p
  LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
  WHERE pce.entity_id IS NULL
  GROUP BY p.person_id, p.display_name, p.name_key
)
SELECT * FROM missing_entities;

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

-- Find potential entity matches for people with no entities
WITH missing_entities AS (
  SELECT
    p.person_id,
    p.display_name,
    clean_name_for_matching(p.display_name) as clean_name
  FROM rs_people p
  LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
  WHERE pce.entity_id IS NULL
  GROUP BY p.person_id, p.display_name
),
potential_matches AS (
  SELECT
    me.person_id,
    me.display_name,
    me.clean_name,
    e.entity_id,
    e.primary_candidate_name,
    e.primary_committee_name,
    clean_name_for_matching(e.primary_candidate_name) as entity_clean_name,
    -- Calculate similarity score
    CASE
      WHEN clean_name_for_matching(e.primary_candidate_name) = me.clean_name THEN 1.0
      WHEN clean_name_for_matching(e.primary_candidate_name) ILIKE '%' || me.clean_name || '%' THEN 0.9
      WHEN me.clean_name ILIKE '%' || clean_name_for_matching(e.primary_candidate_name) || '%' THEN 0.8
      ELSE similarity(clean_name_for_matching(e.primary_candidate_name), me.clean_name)
    END as match_score
  FROM missing_entities me
  CROSS JOIN cf_entities e
  WHERE e.primary_candidate_name IS NOT NULL
    AND LENGTH(e.primary_candidate_name) > 0
)
SELECT
  person_id,
  display_name,
  entity_id,
  primary_candidate_name,
  primary_committee_name,
  match_score
FROM potential_matches
WHERE match_score >= 0.7  -- Only high confidence matches
ORDER BY person_id, match_score DESC;

-- Generate INSERT statements for high-confidence matches
WITH missing_entities AS (
  SELECT
    p.person_id,
    p.display_name,
    clean_name_for_matching(p.display_name) as clean_name
  FROM rs_people p
  LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
  WHERE pce.entity_id IS NULL
  GROUP BY p.person_id, p.display_name
),
best_matches AS (
  SELECT DISTINCT ON (me.person_id)
    me.person_id,
    me.display_name,
    e.entity_id,
    e.primary_candidate_name,
    CASE
      WHEN clean_name_for_matching(e.primary_candidate_name) = me.clean_name THEN 1.0
      WHEN clean_name_for_matching(e.primary_candidate_name) ILIKE '%' || me.clean_name || '%' THEN 0.9
      WHEN me.clean_name ILIKE '%' || clean_name_for_matching(e.primary_candidate_name) || '%' THEN 0.8
      ELSE similarity(clean_name_for_matching(e.primary_candidate_name), me.clean_name)
    END as match_score
  FROM missing_entities me
  CROSS JOIN cf_entities e
  WHERE e.primary_candidate_name IS NOT NULL
    AND LENGTH(e.primary_candidate_name) > 0
    AND (
      clean_name_for_matching(e.primary_candidate_name) = me.clean_name
      OR clean_name_for_matching(e.primary_candidate_name) ILIKE '%' || me.clean_name || '%'
      OR me.clean_name ILIKE '%' || clean_name_for_matching(e.primary_candidate_name) || '%'
      OR similarity(clean_name_for_matching(e.primary_candidate_name), me.clean_name) >= 0.7
    )
  ORDER BY me.person_id, match_score DESC
)
SELECT
  'INSERT INTO rs_person_cf_entities (person_id, entity_id) VALUES (' ||
  person_id || ', ' || entity_id || ') ON CONFLICT DO NOTHING; -- ' ||
  display_name || ' -> ' || primary_candidate_name || ' (score: ' || ROUND(match_score::numeric, 2) || ')'
  as insert_statement
FROM best_matches
WHERE match_score >= 0.8;  -- Only very high confidence for auto-insert

-- Specific fix for Daniel Hernandez Jr. (person_id 126)
DO $$
DECLARE
  v_entity_id INTEGER;
BEGIN
  -- Find entity for Daniel Hernandez
  SELECT entity_id INTO v_entity_id
  FROM cf_entities
  WHERE clean_name_for_matching(primary_candidate_name) ILIKE '%DANIEL%HERNANDEZ%'
  LIMIT 1;

  IF v_entity_id IS NOT NULL THEN
    INSERT INTO rs_person_cf_entities (person_id, entity_id)
    VALUES (126, v_entity_id)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Linked person_id 126 (Daniel Hernandez Jr.) to entity_id %', v_entity_id;
  ELSE
    RAISE NOTICE 'No entity found for Daniel Hernandez';
  END IF;
END $$;

-- Check results for person 126
SELECT
  p.person_id,
  p.display_name,
  pce.entity_id,
  e.primary_candidate_name,
  e.primary_committee_name
FROM rs_people p
LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
LEFT JOIN cf_entities e ON e.entity_id = pce.entity_id
WHERE p.person_id = 126;

-- After running the inserts, refresh the materialized view
-- REFRESH MATERIALIZED VIEW mv_entities_search;