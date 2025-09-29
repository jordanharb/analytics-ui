-- Optimized batch processing version of link_legislators_to_entities.sql
-- This processes legislators in small batches to avoid timeouts

-- First, let's create the helper functions
CREATE OR REPLACE FUNCTION normalize_name_for_matching(name_text TEXT)
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

CREATE OR REPLACE FUNCTION calculate_name_similarity(name1 TEXT, name2 TEXT)
RETURNS FLOAT AS $$
DECLARE
  norm1 TEXT;
  norm2 TEXT;
  similarity_score FLOAT;
BEGIN
  norm1 := normalize_name_for_matching(name1);
  norm2 := normalize_name_for_matching(name2);
  
  -- Exact match
  IF norm1 = norm2 THEN
    RETURN 1.0;
  END IF;
  
  -- Check if one contains the other
  IF norm1 LIKE '%' || norm2 || '%' OR norm2 LIKE '%' || norm1 || '%' THEN
    RETURN 0.9;
  END IF;
  
  -- Use similarity function if available
  BEGIN
    similarity_score := similarity(norm1, norm2);
    RETURN similarity_score;
  EXCEPTION
    WHEN OTHERS THEN
      -- If similarity function is not available, fall back to basic matching
      RETURN 0.0;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Check current state
SELECT 
  'BEFORE - Current relationships:' AS status,
  COUNT(*) AS total_relationships
FROM rs_person_cf_entities;

-- Process legislators in batches of 10
DO $$
DECLARE
  batch_size INTEGER := 10;
  offset_val INTEGER := 0;
  total_processed INTEGER := 0;
  batch_count INTEGER;
BEGIN
  -- Get total count of legislators
  SELECT COUNT(*) INTO batch_count
  FROM legislators l
  JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
  JOIN rs_people p ON pl.person_id = p.person_id;
  
  RAISE NOTICE 'Processing % legislators in batches of %', batch_count, batch_size;
  
  -- Process each batch
  WHILE offset_val < batch_count LOOP
    RAISE NOTICE 'Processing batch starting at offset %', offset_val;
    
    -- Insert matches for this batch
    INSERT INTO rs_person_cf_entities (person_id, entity_id)
    WITH legislator_batch AS (
      SELECT DISTINCT
        l.legislator_id,
        l.full_name AS legislator_name,
        p.person_id,
        p.display_name
      FROM legislators l
      JOIN rs_person_legislators pl ON l.legislator_id = pl.legislator_id
      JOIN rs_people p ON pl.person_id = p.person_id
      ORDER BY l.legislator_id
      LIMIT batch_size OFFSET offset_val
    ),
    entity_candidates AS (
      SELECT DISTINCT
        cer.entity_id,
        cer.entity_name,
        cer.committee_name,
        cer.candidate
      FROM cf_entity_records cer
      WHERE cer.entity_name IS NOT NULL
        AND cer.entity_name != ''
        AND cer.entity_type LIKE '%Candidate%'
    ),
    potential_matches AS (
      SELECT 
        lb.person_id,
        lb.legislator_name,
        ec.entity_id,
        ec.entity_name,
        ec.committee_name,
        ec.candidate,
        -- Calculate similarity scores
        CASE 
          WHEN LOWER(lb.legislator_name) = LOWER(ec.entity_name) THEN 1.0
          WHEN LOWER(lb.legislator_name) = LOWER(ec.candidate) THEN 1.0
          WHEN LOWER(lb.legislator_name) = LOWER(ec.committee_name) THEN 1.0
          WHEN ec.entity_name LIKE '%,%' AND 
               LOWER(lb.legislator_name) = LOWER(
                 TRIM(SPLIT_PART(ec.entity_name, ',', 2)) || ' ' || 
                 TRIM(SPLIT_PART(ec.entity_name, ',', 1))
               ) THEN 0.95
          ELSE calculate_name_similarity(lb.legislator_name, ec.entity_name)
        END AS similarity_score
      FROM legislator_batch lb
      CROSS JOIN entity_candidates ec
      WHERE 
        -- Only consider potential matches
        LOWER(lb.legislator_name) = LOWER(ec.entity_name)
        OR LOWER(lb.legislator_name) = LOWER(ec.candidate)
        OR LOWER(lb.legislator_name) = LOWER(ec.committee_name)
        OR (ec.entity_name LIKE '%,%' AND 
            LOWER(lb.legislator_name) = LOWER(
              TRIM(SPLIT_PART(ec.entity_name, ',', 2)) || ' ' || 
              TRIM(SPLIT_PART(ec.entity_name, ',', 1))
            ))
        OR calculate_name_similarity(lb.legislator_name, ec.entity_name) >= 0.6
    ),
    best_matches AS (
      SELECT DISTINCT ON (pm.person_id, pm.entity_id)
        pm.person_id,
        pm.entity_id,
        pm.legislator_name,
        pm.entity_name,
        pm.similarity_score
      FROM potential_matches pm
      WHERE pm.similarity_score >= 0.6
      ORDER BY pm.person_id, pm.entity_id, pm.similarity_score DESC
    )
    SELECT DISTINCT 
      bm.person_id,
      bm.entity_id
    FROM best_matches bm
    WHERE NOT EXISTS (
      SELECT 1 FROM rs_person_cf_entities pce 
      WHERE pce.person_id = bm.person_id 
        AND pce.entity_id = bm.entity_id
    );
    
    -- Update counters
    GET DIAGNOSTICS total_processed = ROW_COUNT;
    offset_val := offset_val + batch_size;
    
    RAISE NOTICE 'Batch completed. Inserted % new relationships', total_processed;
    
    -- Small delay to prevent overwhelming the database
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'All batches completed!';
END $$;

-- Show final results
SELECT 
  'AFTER - Total relationships:' AS status,
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
  'Sample relationships:' AS status,
  l.full_name AS legislator_name,
  e.primary_candidate_name,
  e.primary_committee_name
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

-- Clean up functions
DROP FUNCTION IF EXISTS normalize_name_for_matching(TEXT);
DROP FUNCTION IF EXISTS calculate_name_similarity(TEXT, TEXT);

