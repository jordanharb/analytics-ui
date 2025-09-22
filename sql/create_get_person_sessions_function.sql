-- Create function to get sessions for a person
-- This function returns all sessions where the person served as a legislator
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

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO anon;