-- Simplified RPC function that directly queries the materialized view
-- This should be much faster and won't timeout

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
  vote_count bigint
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
    COALESCE(vote_count, 0) as vote_count
  FROM rs_mv_people_legislator_index
  WHERE 
    p_q IS NULL 
    OR p_q = '' 
    OR display_name ILIKE '%' || p_q || '%'
  ORDER BY display_name
  LIMIT p_limit 
  OFFSET p_offset;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.rs_people_index_simple TO authenticated;
GRANT EXECUTE ON FUNCTION public.rs_people_index_simple TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION public.rs_people_index_simple IS 'Simplified people index that directly queries the materialized view for better performance';