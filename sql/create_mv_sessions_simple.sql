-- Drop existing materialized view if it exists
DROP MATERIALIZED VIEW IF EXISTS mv_sessions_with_dates CASCADE;

-- Create a simple materialized view with just first and last vote dates
CREATE MATERIALIZED VIEW mv_sessions_with_dates AS
SELECT
  s.session_id,
  s.session_name,
  s.year,
  s.start_date AS official_start_date,
  s.end_date AS official_end_date,
  vote_dates.first_vote_date,
  vote_dates.last_vote_date,
  -- Create a formatted date range string
  CASE
    WHEN vote_dates.first_vote_date IS NOT NULL AND vote_dates.last_vote_date IS NOT NULL THEN
      TO_CHAR(vote_dates.first_vote_date, 'Mon DD, YYYY') || ' - ' || TO_CHAR(vote_dates.last_vote_date, 'Mon DD, YYYY')
    WHEN s.start_date IS NOT NULL AND s.end_date IS NOT NULL THEN
      TO_CHAR(s.start_date, 'Mon DD, YYYY') || ' - ' || TO_CHAR(s.end_date, 'Mon DD, YYYY')
    WHEN s.year IS NOT NULL THEN
      'Year ' || s.year::TEXT
    ELSE
      'No dates available'
  END AS date_range_display
FROM sessions s
LEFT JOIN LATERAL (
  SELECT
    MIN(v.vote_date) AS first_vote_date,
    MAX(v.vote_date) AS last_vote_date
  FROM bills b
  INNER JOIN votes v ON v.bill_id = b.bill_id
  WHERE b.session_id = s.session_id
    AND v.vote_date IS NOT NULL
) vote_dates ON true
ORDER BY s.year DESC, s.session_id DESC;

-- Create index for performance
CREATE INDEX idx_mv_sessions_session_id ON mv_sessions_with_dates(session_id);

-- Grant permissions
GRANT SELECT ON mv_sessions_with_dates TO authenticated;
GRANT SELECT ON mv_sessions_with_dates TO anon;
GRANT SELECT ON mv_sessions_with_dates TO service_role;

-- Refresh the materialized view with data
REFRESH MATERIALIZED VIEW mv_sessions_with_dates;