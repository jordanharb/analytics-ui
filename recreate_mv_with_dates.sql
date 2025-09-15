-- Drop and recreate the materialized view with the new columns
DROP MATERIALIZED VIEW IF EXISTS rs_mv_people_legislator_index;

CREATE MATERIALIZED VIEW rs_mv_people_legislator_index AS
WITH person_activity AS (
  -- Get all activity data for each person
  SELECT 
    pl.person_id,
    pl.legislator_id,
    MIN(v.vote_date) as first_vote_date,
    MAX(v.vote_date) as last_vote_date,
    MAX(b.session_id) as latest_session_id
  FROM rs_person_legislators pl
  LEFT JOIN votes v ON v.legislator_id = pl.legislator_id
  LEFT JOIN bills b ON b.bill_id = v.bill_id
  WHERE v.vote_date IS NOT NULL
  GROUP BY pl.person_id, pl.legislator_id
),
person_sessions AS (
  -- Get the latest session for each person
  SELECT DISTINCT ON (pa.person_id)
    pa.person_id,
    pa.latest_session_id as last_session_id,
    s.session_name as last_session_name
  FROM person_activity pa
  LEFT JOIN sessions s ON s.session_id = pa.latest_session_id
  ORDER BY pa.person_id, pa.last_vote_date DESC
),
person_aggregated AS (
  -- Aggregate all data per person
  SELECT 
    pl.person_id,
    p.display_name,
    array_agg(DISTINCT 
      CASE 
        WHEN l.body = 'H' OR l.body = 'House' THEN 'H ' || COALESCE(l.district::text, '')
        WHEN l.body = 'S' OR l.body = 'Senate' THEN 'S ' || COALESCE(l.district::text, '')
        ELSE COALESCE(l.body, '') || ' ' || COALESCE(l.district::text, '')
      END
    ) as positions_held,
    COUNT(DISTINCT bs.id) as sponsored_count,
    COUNT(DISTINCT v.vote_id) as vote_count,
    MIN(pa.first_vote_date) as first_active_date,
    MAX(pa.last_vote_date) as last_active_date
  FROM rs_people p
  JOIN rs_person_legislators pl ON pl.person_id = p.person_id
  LEFT JOIN legislators l ON l.legislator_id = pl.legislator_id
  LEFT JOIN votes v ON v.legislator_id = pl.legislator_id
  LEFT JOIN bill_sponsors bs ON bs.legislator_id = pl.legislator_id
  LEFT JOIN person_activity pa ON pa.person_id = pl.person_id AND pa.legislator_id = pl.legislator_id
  GROUP BY pl.person_id, p.display_name
)
SELECT 
  pa.person_id,
  pa.display_name,
  pa.positions_held,
  ps.last_session_id,
  ps.last_session_name,
  pa.sponsored_count,
  pa.vote_count,
  pa.first_active_date,
  pa.last_active_date
FROM person_aggregated pa
LEFT JOIN person_sessions ps ON ps.person_id = pa.person_id
ORDER BY pa.display_name;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_mv_people_person_id ON rs_mv_people_legislator_index(person_id);
CREATE INDEX IF NOT EXISTS idx_mv_people_display_name ON rs_mv_people_legislator_index(display_name);
CREATE INDEX IF NOT EXISTS idx_mv_people_last_session_id ON rs_mv_people_legislator_index(last_session_id);

-- Grant permissions
GRANT SELECT ON rs_mv_people_legislator_index TO authenticated;
GRANT SELECT ON rs_mv_people_legislator_index TO anon;

-- Update the RPC function to return the new columns
CREATE OR REPLACE FUNCTION public.rs_people_index_simple(
  p_q text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  person_id bigint,
  display_name text,
  positions_held text[],
  last_session_id int,
  last_session_name text,
  sponsored_count bigint,
  vote_count bigint,
  first_active_date date,
  last_active_date date
) 
LANGUAGE sql 
STABLE
ROWS 100
AS $$
  SELECT
    person_id,
    display_name,
    positions_held,
    last_session_id,
    last_session_name,
    COALESCE(sponsored_count, 0) as sponsored_count,
    COALESCE(vote_count, 0) as vote_count,
    first_active_date,
    last_active_date
  FROM rs_mv_people_legislator_index
  WHERE 
    p_q IS NULL 
    OR p_q = '' 
    OR display_name ILIKE '%' || p_q || '%'
  ORDER BY display_name
  LIMIT p_limit 
  OFFSET p_offset;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.rs_people_index_simple TO authenticated;
GRANT EXECUTE ON FUNCTION public.rs_people_index_simple TO anon;