-- Drop and recreate the materialized view with the new columns
DROP MATERIALIZED VIEW IF EXISTS rs_mv_people_legislator_index;

CREATE MATERIALIZED VIEW rs_mv_people_legislator_index AS
WITH person_votes AS (
  -- Get vote activity for each person
  SELECT 
    pl.person_id,
    MIN(v.vote_date) as first_active_date,
    MAX(v.vote_date) as last_active_date,
    COUNT(DISTINCT v.vote_id) as vote_count
  FROM rs_person_legislators pl
  LEFT JOIN votes v ON v.legislator_id = pl.legislator_id
  WHERE v.vote_date IS NOT NULL
  GROUP BY pl.person_id
),
person_latest_session AS (
  -- Get the latest session for each person based on their last vote
  SELECT DISTINCT ON (pl.person_id)
    pl.person_id,
    b.session_id as last_session_id,
    s.session_name as last_session_name
  FROM rs_person_legislators pl
  JOIN votes v ON v.legislator_id = pl.legislator_id
  JOIN bills b ON b.bill_id = v.bill_id
  LEFT JOIN sessions s ON s.session_id = b.session_id
  WHERE v.vote_date IS NOT NULL
  ORDER BY pl.person_id, v.vote_date DESC
),
person_sponsors AS (
  -- Count sponsored bills
  SELECT 
    pl.person_id,
    COUNT(DISTINCT bs.id) as sponsored_count
  FROM rs_person_legislators pl
  LEFT JOIN bill_sponsors bs ON bs.legislator_id = pl.legislator_id
  GROUP BY pl.person_id
),
person_positions AS (
  -- Get positions held (simplified - just get from legislators table)
  SELECT 
    pl.person_id,
    array_agg(DISTINCT 
      CASE 
        WHEN l.full_name IS NOT NULL THEN 
          CASE 
            WHEN l.district LIKE 'LD%' THEN 'H ' || l.district
            ELSE COALESCE('L ' || l.district, 'L')
          END
        ELSE 'Unknown'
      END
    ) as positions_held
  FROM rs_person_legislators pl
  LEFT JOIN legislators l ON l.legislator_id = pl.legislator_id
  GROUP BY pl.person_id
)
SELECT 
  p.person_id,
  p.display_name,
  COALESCE(pp.positions_held, ARRAY[]::text[]) as positions_held,
  pls.last_session_id,
  pls.last_session_name,
  COALESCE(ps.sponsored_count, 0) as sponsored_count,
  COALESCE(pv.vote_count, 0) as vote_count,
  pv.first_active_date,
  pv.last_active_date
FROM rs_people p
LEFT JOIN person_positions pp ON pp.person_id = p.person_id
LEFT JOIN person_latest_session pls ON pls.person_id = p.person_id
LEFT JOIN person_sponsors ps ON ps.person_id = p.person_id
LEFT JOIN person_votes pv ON pv.person_id = p.person_id
WHERE EXISTS (
  SELECT 1 FROM rs_person_legislators pl WHERE pl.person_id = p.person_id
)
ORDER BY p.display_name;

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