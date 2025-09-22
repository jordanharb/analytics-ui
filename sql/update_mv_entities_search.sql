-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS mv_entities_search CASCADE;

-- Create enhanced materialized view with arrays for session_ids, entity_ids, and legislator_ids
CREATE MATERIALIZED VIEW mv_entities_search AS
WITH person_aggregates AS (
  SELECT
    p.person_id,
    p.display_name,
    p.name_key,

    -- Aggregate all linked session_ids
    ARRAY_AGG(DISTINCT pls.session_id ORDER BY pls.session_id) FILTER (WHERE pls.session_id IS NOT NULL) AS all_session_ids,

    -- Aggregate all linked entity_ids
    ARRAY_AGG(DISTINCT pce.entity_id ORDER BY pce.entity_id) FILTER (WHERE pce.entity_id IS NOT NULL) AS all_entity_ids,

    -- Aggregate all linked legislator_ids
    ARRAY_AGG(DISTINCT pl.legislator_id ORDER BY pl.legislator_id) FILTER (WHERE pl.legislator_id IS NOT NULL) AS all_legislator_ids

  FROM rs_people p
  LEFT JOIN rs_person_leg_sessions pls ON p.person_id = pls.person_id
  LEFT JOIN rs_person_cf_entities pce ON p.person_id = pce.person_id
  LEFT JOIN rs_person_legislators pl ON p.person_id = pl.person_id
  GROUP BY p.person_id, p.display_name, p.name_key
)
SELECT
  pa.person_id,
  pa.display_name,
  pa.name_key,
  pa.all_session_ids,
  pa.all_entity_ids,
  pa.all_legislator_ids,

  -- Get primary entity info if available
  e.entity_id,
  e.primary_committee_name,
  e.primary_candidate_name,
  e.total_income_all_records,
  e.total_expense_all_records,
  e.earliest_activity,
  e.latest_activity,

  -- Get primary legislator info if available
  l.legislator_id,
  l.full_name AS legislator_name,
  l.party,
  l.body,
  l.district,

  -- Search vector for full text search
  to_tsvector('english',
    COALESCE(pa.display_name, '') || ' ' ||
    COALESCE(e.primary_committee_name, '') || ' ' ||
    COALESCE(e.primary_candidate_name, '') || ' ' ||
    COALESCE(l.full_name, '')
  ) AS search_vector

FROM person_aggregates pa
LEFT JOIN rs_person_cf_entities pce ON pa.person_id = pce.person_id
  AND pce.entity_id = (
    SELECT entity_id FROM rs_person_cf_entities
    WHERE person_id = pa.person_id
    ORDER BY entity_id
    LIMIT 1
  )
LEFT JOIN cf_entities e ON pce.entity_id = e.entity_id
LEFT JOIN rs_person_legislators pl ON pa.person_id = pl.person_id
  AND pl.legislator_id = (
    SELECT legislator_id FROM rs_person_legislators
    WHERE person_id = pa.person_id
    ORDER BY legislator_id
    LIMIT 1
  )
LEFT JOIN legislators l ON pl.legislator_id = l.legislator_id;

-- Create indexes for performance
CREATE INDEX idx_mv_entities_search_person_id ON mv_entities_search(person_id);
CREATE INDEX idx_mv_entities_search_display_name ON mv_entities_search(display_name);
CREATE INDEX idx_mv_entities_search_entity_id ON mv_entities_search(entity_id);
CREATE INDEX idx_mv_entities_search_legislator_id ON mv_entities_search(legislator_id);
CREATE INDEX idx_mv_entities_search_fts ON mv_entities_search USING gin(search_vector);

-- Create RPC function to search the materialized view
CREATE OR REPLACE FUNCTION search_people_with_sessions(
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
    -- Return all people if no search term
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
    FROM mv_entities_search m
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
    FROM mv_entities_search m
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

-- Create function to get sessions for a person
CREATE OR REPLACE FUNCTION get_person_sessions(
  p_person_id BIGINT
)
RETURNS TABLE (
  session_id INTEGER,
  session_name VARCHAR,
  year INTEGER,
  start_date DATE,
  end_date DATE,
  vote_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    s.session_id,
    s.session_name,
    s.year,
    s.start_date,
    s.end_date,
    COUNT(DISTINCT v.vote_id) AS vote_count
  FROM rs_person_leg_sessions pls
  JOIN sessions s ON pls.session_id = s.session_id
  LEFT JOIN votes v ON v.legislator_id = pls.legislator_id AND v.bill_id IN (
    SELECT b.bill_id FROM bills b WHERE b.session_id = s.session_id
  )
  WHERE pls.person_id = p_person_id
  GROUP BY s.session_id, s.session_name, s.year, s.start_date, s.end_date
  ORDER BY s.year DESC, s.session_id DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Refresh the materialized view with data
REFRESH MATERIALIZED VIEW mv_entities_search;