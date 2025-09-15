-- First, add the new columns to the materialized view table
ALTER TABLE rs_mv_people_legislator_index 
ADD COLUMN IF NOT EXISTS first_active_date date,
ADD COLUMN IF NOT EXISTS last_active_date date;

-- Update the materialized view with session and date information
WITH person_activity AS (
  -- Get first and last vote dates and session info for each person
  SELECT 
    p.person_id,
    MIN(v.vote_date) as first_active_date,
    MAX(v.vote_date) as last_active_date,
    LAST_VALUE(b.session_id) OVER (
      PARTITION BY p.person_id 
      ORDER BY v.vote_date 
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as last_session_id
  FROM rs_mv_people_legislator_index p
  JOIN rs_person_legislators pl ON pl.person_id = p.person_id
  JOIN votes v ON v.legislator_id = pl.legislator_id
  JOIN bills b ON b.bill_id = v.bill_id
  WHERE v.vote_date IS NOT NULL
  GROUP BY p.person_id, b.session_id, v.vote_date
),
session_names AS (
  -- Get session names
  SELECT DISTINCT
    pa.person_id,
    pa.first_active_date,
    pa.last_active_date,
    pa.last_session_id,
    s.session_label as last_session_name
  FROM person_activity pa
  LEFT JOIN sessions s ON s.session_id = pa.last_session_id
),
aggregated AS (
  -- Aggregate to one row per person with the latest session
  SELECT 
    person_id,
    MIN(first_active_date) as first_active_date,
    MAX(last_active_date) as last_active_date,
    MAX(last_session_id) as last_session_id,
    MAX(last_session_name) as last_session_name
  FROM session_names
  GROUP BY person_id
)
-- Update the materialized view
UPDATE rs_mv_people_legislator_index mv
SET 
  first_active_date = a.first_active_date,
  last_active_date = a.last_active_date,
  last_session_id = a.last_session_id,
  last_session_name = a.last_session_name
FROM aggregated a
WHERE mv.person_id = a.person_id;

-- Create or replace the simplified RPC function to include new columns
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.rs_people_index_simple TO authenticated;
GRANT EXECUTE ON FUNCTION public.rs_people_index_simple TO anon;