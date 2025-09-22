-- Create a function to get analyzed bills stats (for incremental analysis)
-- For now, we'll create a stub that returns no previous analysis
CREATE OR REPLACE FUNCTION get_analyzed_bills_stats(
  p_person_id BIGINT,
  p_session_id INT
)
RETURNS TABLE (
  analyzed_bills INT,
  report_count INT,
  last_analysis TIMESTAMP,
  analyzedBillIds INT[]
)
LANGUAGE sql
STABLE
AS $$
  -- Check if there are any previous analysis reports for this person/session
  SELECT
    COALESCE(COUNT(DISTINCT UNNEST(bill_ids)), 0)::INT as analyzed_bills,
    COUNT(*)::INT as report_count,
    MAX(created_at) as last_analysis,
    ARRAY_AGG(DISTINCT bill_id ORDER BY bill_id) as analyzedBillIds
  FROM rs_analysis_reports
  CROSS JOIN LATERAL UNNEST(bill_ids) AS bill_id
  WHERE person_id = p_person_id
    AND session_id = p_session_id
  GROUP BY person_id, session_id
  LIMIT 1;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_analyzed_bills_stats(BIGINT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_analyzed_bills_stats(BIGINT, INT) TO anon;
GRANT EXECUTE ON FUNCTION get_analyzed_bills_stats(BIGINT, INT) TO service_role;