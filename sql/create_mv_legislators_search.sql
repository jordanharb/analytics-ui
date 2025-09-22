-- Drop existing materialized view if it exists
DROP MATERIALIZED VIEW IF EXISTS mv_legislators_search CASCADE;

-- Create materialized view for LEGISLATORS ONLY (filters out non-legislators)
CREATE MATERIALIZED VIEW mv_legislators_search AS
WITH legislator_aggregates AS (
  SELECT
    p.person_id,
    p.display_name,
    p.name_key,

    -- Aggregate all linked session_ids (only for people with legislator links)
    ARRAY_AGG(DISTINCT pls.session_id ORDER BY pls.session_id) FILTER (WHERE pls.session_id IS NOT NULL) AS all_session_ids,

    -- Aggregate all linked entity_ids
    ARRAY_AGG(DISTINCT pce.entity_id ORDER BY pce.entity_id) FILTER (WHERE pce.entity_id IS NOT NULL) AS all_entity_ids,

    -- Aggregate all linked legislator_ids
    ARRAY_AGG(DISTINCT pl.legislator_id ORDER BY pl.legislator_id) FILTER (WHERE pl.legislator_id IS NOT NULL) AS all_legislator_ids

  FROM rs_people p
  INNER JOIN rs_person_legislators pl ON p.person_id = pl.person_id  -- INNER JOIN ensures only people with legislator links
  LEFT JOIN rs_person_leg_sessions pls ON p.person_id = pls.person_id
  LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
  GROUP BY p.person_id, p.display_name, p.name_key
)
SELECT
  la.person_id,
  la.display_name,
  la.name_key,
  la.all_session_ids,
  la.all_entity_ids,
  la.all_legislator_ids,

  -- Get primary entity info if available
  e.entity_id,
  e.primary_committee_name,
  e.primary_candidate_name,
  e.total_income_all_records,
  e.total_expense_all_records,
  e.earliest_activity,
  e.latest_activity,

  -- Get primary legislator info
  l.legislator_id,
  l.full_name AS legislator_name,
  l.party,
  l.body,
  l.district,

  -- Search vector for full text search
  to_tsvector('english',
    COALESCE(la.display_name, '') || ' ' ||
    COALESCE(e.primary_committee_name, '') || ' ' ||
    COALESCE(e.primary_candidate_name, '') || ' ' ||
    COALESCE(l.full_name, '')
  ) AS search_vector

FROM legislator_aggregates la
LEFT JOIN rs_person_cf_entities pce ON la.person_id = pce.person_id
  AND pce.entity_id = (
    SELECT entity_id FROM rs_person_cf_entities
    WHERE person_id = la.person_id
    ORDER BY entity_id
    LIMIT 1
  )
LEFT JOIN cf_entities e ON pce.entity_id = e.entity_id
LEFT JOIN rs_person_legislators pl ON la.person_id = pl.person_id
  AND pl.legislator_id = (
    SELECT legislator_id FROM rs_person_legislators
    WHERE person_id = la.person_id
    ORDER BY legislator_id
    LIMIT 1
  )
LEFT JOIN legislators l ON pl.legislator_id = l.legislator_id
WHERE la.all_legislator_ids IS NOT NULL  -- Extra filter to ensure we only have legislators
  AND array_length(la.all_legislator_ids, 1) > 0;

-- Create indexes for performance
CREATE INDEX idx_mv_legislators_search_person_id ON mv_legislators_search(person_id);
CREATE INDEX idx_mv_legislators_search_display_name ON mv_legislators_search(display_name);
CREATE INDEX idx_mv_legislators_search_entity_id ON mv_legislators_search(entity_id);
CREATE INDEX idx_mv_legislators_search_legislator_id ON mv_legislators_search(legislator_id);
CREATE INDEX idx_mv_legislators_search_fts ON mv_legislators_search USING gin(search_vector);

-- Create RPC function to search legislators only
CREATE OR REPLACE FUNCTION search_legislators_with_sessions(
  p_search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  person_id BIGINT,
  display_name TEXT,
  all_session_ids INTEGER[],
  all_entity_ids INTEGER[],
  all_legislator_ids INTEGER[],
  primary_entity_id INTEGER,
  primary_committee_name VARCHAR,
  primary_candidate_name VARCHAR,
  total_income NUMERIC,
  total_expense NUMERIC,
  party VARCHAR,
  body VARCHAR,
  district INTEGER
) AS $$
BEGIN
  IF p_search_term IS NULL OR p_search_term = '' THEN
    -- Return all legislators if no search term
    RETURN QUERY
    SELECT
      m.person_id,
      m.display_name,
      m.all_session_ids,
      m.all_entity_ids,
      m.all_legislator_ids,
      m.entity_id AS primary_entity_id,
      m.primary_committee_name,
      m.primary_candidate_name,
      m.total_income_all_records AS total_income,
      m.total_expense_all_records AS total_expense,
      m.party,
      m.body,
      m.district
    FROM mv_legislators_search m
    ORDER BY m.display_name
    LIMIT 100;
  ELSE
    -- Search using full text search
    RETURN QUERY
    SELECT
      m.person_id,
      m.display_name,
      m.all_session_ids,
      m.all_entity_ids,
      m.all_legislator_ids,
      m.entity_id AS primary_entity_id,
      m.primary_committee_name,
      m.primary_candidate_name,
      m.total_income_all_records AS total_income,
      m.total_expense_all_records AS total_expense,
      m.party,
      m.body,
      m.district
    FROM mv_legislators_search m
    WHERE m.search_vector @@ plainto_tsquery('english', p_search_term)
       OR LOWER(m.display_name) LIKE LOWER('%' || p_search_term || '%')
    ORDER BY
      CASE
        WHEN LOWER(m.display_name) LIKE LOWER(p_search_term || '%') THEN 1
        WHEN LOWER(m.display_name) LIKE LOWER('%' || p_search_term || '%') THEN 2
        ELSE 3
      END,
      m.display_name
    LIMIT 100;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Refresh the materialized view with data
REFRESH MATERIALIZED VIEW mv_legislators_search;