-- Drop and recreate the get_person_sessions function to use the simpler materialized view
DROP FUNCTION IF EXISTS get_person_sessions(BIGINT);

CREATE OR REPLACE FUNCTION get_person_sessions(p_person_id BIGINT)
RETURNS TABLE (
  session_id INT,
  session_name VARCHAR,
  year INT,
  start_date DATE,
  end_date DATE,
  vote_count BIGINT,
  date_range_display TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    s.session_id::INT,
    s.session_name,
    s.year::INT,
    COALESCE(s.first_vote_date, s.official_start_date) AS start_date,
    COALESCE(s.last_vote_date, s.official_end_date) AS end_date,
    0::BIGINT as vote_count,  -- We'll calculate this separately if needed
    s.date_range_display
  FROM rs_person_leg_sessions pls
  INNER JOIN mv_sessions_with_dates s ON pls.session_id = s.session_id
  WHERE pls.person_id = p_person_id
  ORDER BY s.year DESC, s.session_id DESC;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO service_role;