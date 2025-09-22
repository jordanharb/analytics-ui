-- Script to deduplicate people with similar names (ignoring suffixes like Jr., Sr., III, etc.)
-- and merge all their linked records

-- First, create a function to normalize names for comparison
CREATE OR REPLACE FUNCTION normalize_name_for_comparison(input_name TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Remove common suffixes and clean up the name for comparison
  RETURN TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              UPPER(input_name),
              '\s+(JR\.?|SR\.?|III|II|IV|V|VI|VII|VIII|IX|X)\.?\s*$', '', 'gi'
            ),
            '\s+', ' ', 'g'  -- Replace multiple spaces with single space
          ),
          '^\s+|\s+$', '', 'g'  -- Trim leading/trailing spaces
        ),
        '[,.]', '', 'g'  -- Remove commas and periods
      ),
      '\s+(JUNIOR|SENIOR)\.?\s*$', '', 'gi'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a temp table to identify duplicate groups
CREATE TEMP TABLE duplicate_groups AS
WITH normalized_names AS (
  SELECT
    person_id,
    display_name,
    normalize_name_for_comparison(display_name) as normalized_name,
    created_at
  FROM rs_people
),
duplicate_pairs AS (
  SELECT
    n1.person_id as keep_id,
    n1.display_name as keep_name,
    n2.person_id as merge_id,
    n2.display_name as merge_name,
    n1.normalized_name
  FROM normalized_names n1
  JOIN normalized_names n2 ON n1.normalized_name = n2.normalized_name
  WHERE n1.person_id < n2.person_id  -- Keep the lower ID as primary
)
SELECT * FROM duplicate_pairs
ORDER BY normalized_name, keep_id, merge_id;

-- Display the duplicates that will be merged
SELECT
  keep_id,
  keep_name,
  merge_id,
  merge_name,
  normalized_name
FROM duplicate_groups
ORDER BY normalized_name;

-- Begin transaction for safe merging
BEGIN;

-- Merge rs_person_legislators (legislators linked to people)
WITH merges AS (
  SELECT * FROM duplicate_groups
)
UPDATE rs_person_legislators pl
SET person_id = m.keep_id
FROM merges m
WHERE pl.person_id = m.merge_id
  AND NOT EXISTS (
    -- Don't create duplicates
    SELECT 1 FROM rs_person_legislators pl2
    WHERE pl2.person_id = m.keep_id
    AND pl2.legislator_id = pl.legislator_id
  );

-- Delete any remaining duplicates
DELETE FROM rs_person_legislators
WHERE (person_id, legislator_id) IN (
  SELECT pl.person_id, pl.legislator_id
  FROM rs_person_legislators pl
  JOIN duplicate_groups dg ON pl.person_id = dg.merge_id
  WHERE EXISTS (
    SELECT 1 FROM rs_person_legislators pl2
    WHERE pl2.person_id = dg.keep_id
    AND pl2.legislator_id = pl.legislator_id
  )
);

-- Merge rs_person_leg_sessions (legislative sessions linked to people)
WITH merges AS (
  SELECT * FROM duplicate_groups
)
UPDATE rs_person_leg_sessions pls
SET person_id = m.keep_id
FROM merges m
WHERE pls.person_id = m.merge_id
  AND NOT EXISTS (
    -- Don't create duplicates
    SELECT 1 FROM rs_person_leg_sessions pls2
    WHERE pls2.person_id = m.keep_id
    AND pls2.legislator_id = pls.legislator_id
    AND pls2.session_id = pls.session_id
  );

-- Delete any remaining duplicates
DELETE FROM rs_person_leg_sessions
WHERE (person_id, legislator_id, session_id) IN (
  SELECT pls.person_id, pls.legislator_id, pls.session_id
  FROM rs_person_leg_sessions pls
  JOIN duplicate_groups dg ON pls.person_id = dg.merge_id
  WHERE EXISTS (
    SELECT 1 FROM rs_person_leg_sessions pls2
    WHERE pls2.person_id = dg.keep_id
    AND pls2.legislator_id = pls.legislator_id
    AND pls2.session_id = pls.session_id
  )
);

-- Merge rs_person_cf_entities (campaign finance entities linked to people)
WITH merges AS (
  SELECT * FROM duplicate_groups
)
UPDATE rs_person_cf_entities pce
SET person_id = m.keep_id
FROM merges m
WHERE pce.person_id = m.merge_id
  AND NOT EXISTS (
    -- Don't create duplicates
    SELECT 1 FROM rs_person_cf_entities pce2
    WHERE pce2.person_id = m.keep_id
    AND pce2.entity_id = pce.entity_id
  );

-- Delete any remaining duplicates
DELETE FROM rs_person_cf_entities
WHERE (person_id, entity_id) IN (
  SELECT pce.person_id, pce.entity_id
  FROM rs_person_cf_entities pce
  JOIN duplicate_groups dg ON pce.person_id = dg.merge_id
  WHERE EXISTS (
    SELECT 1 FROM rs_person_cf_entities pce2
    WHERE pce2.person_id = dg.keep_id
    AND pce2.entity_id = pce.entity_id
  )
);

-- Merge rs_person_tx_entities (transaction entities linked to people)
WITH merges AS (
  SELECT * FROM duplicate_groups
)
UPDATE rs_person_tx_entities pte
SET person_id = m.keep_id
FROM merges m
WHERE pte.person_id = m.merge_id
  AND NOT EXISTS (
    -- Don't create duplicates
    SELECT 1 FROM rs_person_tx_entities pte2
    WHERE pte2.person_id = m.keep_id
    AND pte2.transaction_entity_id = pte.transaction_entity_id
  );

-- Delete any remaining duplicates
DELETE FROM rs_person_tx_entities
WHERE (person_id, transaction_entity_id) IN (
  SELECT pte.person_id, pte.transaction_entity_id
  FROM rs_person_tx_entities pte
  JOIN duplicate_groups dg ON pte.person_id = dg.merge_id
  WHERE EXISTS (
    SELECT 1 FROM rs_person_tx_entities pte2
    WHERE pte2.person_id = dg.keep_id
    AND pte2.transaction_entity_id = pte.transaction_entity_id
  )
);

-- Update rs_analysis_reports to point to the kept person
UPDATE rs_analysis_reports ar
SET person_id = dg.keep_id
FROM duplicate_groups dg
WHERE ar.person_id = dg.merge_id;

-- Now delete the duplicate person records
DELETE FROM rs_people
WHERE person_id IN (SELECT merge_id FROM duplicate_groups);

-- Show summary of what was merged
SELECT
  'Merged ' || COUNT(DISTINCT merge_id) || ' duplicate people into ' ||
  COUNT(DISTINCT keep_id) || ' primary records' as summary
FROM duplicate_groups;

-- Show the final deduplicated people
SELECT
  dg.keep_id as kept_person_id,
  p.display_name as kept_name,
  STRING_AGG(DISTINCT dg.merge_name, ', ') as merged_names,
  COUNT(DISTINCT dg.merge_id) as duplicates_merged
FROM duplicate_groups dg
JOIN rs_people p ON p.person_id = dg.keep_id
GROUP BY dg.keep_id, p.display_name
ORDER BY p.display_name;

COMMIT;

-- Refresh materialized views to reflect the changes
REFRESH MATERIALIZED VIEW mv_entities_search;
REFRESH MATERIALIZED VIEW mv_legislators_search;

-- Drop the temporary table
DROP TABLE IF EXISTS duplicate_groups;

-- Optional: Drop the normalization function if you don't want to keep it
-- DROP FUNCTION IF EXISTS normalize_name_for_comparison(TEXT);