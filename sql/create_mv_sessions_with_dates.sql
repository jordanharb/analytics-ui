-- Drop existing materialized view if it exists
DROP MATERIALIZED VIEW IF EXISTS mv_sessions_with_dates CASCADE;

-- Create materialized view for sessions with calculated date ranges from votes
CREATE MATERIALIZED VIEW mv_sessions_with_dates AS
WITH session_vote_dates AS (
  SELECT
    s.session_id,
    s.session_name,
    s.legislature_number,
    s.session_type,
    s.year,
    s.start_date AS official_start_date,
    s.end_date AS official_end_date,
    MIN(v.vote_date) AS first_vote_date,
    MAX(v.vote_date) AS last_vote_date,
    COUNT(DISTINCT v.vote_id) AS total_votes,
    COUNT(DISTINCT v.bill_id) AS total_bills_voted,
    COUNT(DISTINCT v.legislator_id) AS total_legislators_voting
  FROM sessions s
  LEFT JOIN votes v ON v.bill_id IN (
    SELECT bill_id FROM bills WHERE session_id = s.session_id
  )
  GROUP BY
    s.session_id,
    s.session_name,
    s.legislature_number,
    s.session_type,
    s.year,
    s.start_date,
    s.end_date
)
SELECT
  session_id,
  session_name,
  legislature_number,
  session_type,
  year,
  -- Use vote dates if available, otherwise fall back to official dates
  COALESCE(first_vote_date, official_start_date) AS start_date,
  COALESCE(last_vote_date, official_end_date) AS end_date,
  official_start_date,
  official_end_date,
  first_vote_date,
  last_vote_date,
  total_votes,
  total_bills_voted,
  total_legislators_voting,
  -- Create a formatted date range string
  CASE
    WHEN first_vote_date IS NOT NULL AND last_vote_date IS NOT NULL THEN
      TO_CHAR(first_vote_date, 'Mon DD, YYYY') || ' - ' || TO_CHAR(last_vote_date, 'Mon DD, YYYY')
    WHEN official_start_date IS NOT NULL AND official_end_date IS NOT NULL THEN
      TO_CHAR(official_start_date, 'Mon DD, YYYY') || ' - ' || TO_CHAR(official_end_date, 'Mon DD, YYYY')
    WHEN year IS NOT NULL THEN
      'Year ' || year::TEXT
    ELSE
      'No dates available'
  END AS date_range_display
FROM session_vote_dates
ORDER BY year DESC, session_id DESC;

-- Create indexes for better performance
CREATE INDEX idx_mv_sessions_session_id ON mv_sessions_with_dates(session_id);
CREATE INDEX idx_mv_sessions_year ON mv_sessions_with_dates(year);
CREATE INDEX idx_mv_sessions_start_date ON mv_sessions_with_dates(start_date);

-- Update the get_person_sessions function to use the materialized view
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
    s.start_date,
    s.end_date,
    COALESCE(vote_counts.vote_count, s.total_votes, 0)::BIGINT as vote_count,
    s.date_range_display
  FROM rs_person_leg_sessions pls
  INNER JOIN mv_sessions_with_dates s ON pls.session_id = s.session_id
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT v.vote_id) as vote_count
    FROM votes v
    WHERE v.legislator_id = pls.legislator_id
      AND v.bill_id IN (
        SELECT b.bill_id FROM bills b WHERE b.session_id = s.session_id
      )
  ) vote_counts ON true
  WHERE pls.person_id = p_person_id
  ORDER BY s.year DESC, s.session_id DESC;
$$;

-- Grant permissions
GRANT SELECT ON mv_sessions_with_dates TO authenticated;
GRANT SELECT ON mv_sessions_with_dates TO anon;
GRANT SELECT ON mv_sessions_with_dates TO service_role;

GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION get_person_sessions(BIGINT) TO service_role;

-- Refresh the materialized view with data
REFRESH MATERIALIZED VIEW mv_sessions_with_dates;

-- Optional: Create a function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_sessions_view()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  REFRESH MATERIALIZED VIEW mv_sessions_with_dates;
$$;

GRANT EXECUTE ON FUNCTION refresh_sessions_view() TO authenticated;