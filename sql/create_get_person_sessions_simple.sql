-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_person_sessions(BIGINT);

-- Create a simpler version of get_person_sessions
CREATE OR REPLACE FUNCTION get_person_sessions(p_person_id BIGINT)
RETURNS TABLE (
  session_id INT,
  session_name VARCHAR,
  year INT,
  start_date DATE,
  end_date DATE,
  vote_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    s.session_id::INT,
    s.session_name,
    s.year::INT,
    s.start_date,
    s.end_date,
    COALESCE(vote_counts.vote_count, 0)::BIGINT as vote_count
  FROM rs_person_leg_sessions pls
  INNER JOIN sessions s ON pls.session_id = s.session_id
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT v.vote_id) as vote_count
    FROM votes v
    INNER JOIN bills b ON v.bill_id = b.bill_id
    WHERE v.legislator_id = pls.legislator_id
      AND b.session_id = s.session_id
  ) vote_counts ON true
  WHERE pls.person_id = p_person_id
  ORDER BY s.year DESC, s.session_id DESC;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO service_role;