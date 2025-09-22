-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_analyzed_bills_stats(BIGINT, INT);

-- Create function to get stats about previously analyzed bills for incremental analysis
CREATE OR REPLACE FUNCTION get_analyzed_bills_stats(
  p_person_id BIGINT,
  p_session_id INT
)
RETURNS TABLE (
  analyzed_bills INT,
  report_count INT,
  last_analysis TIMESTAMP WITH TIME ZONE,
  analyzedBillIds INT[]
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Return aggregated stats for previous analysis reports
  RETURN QUERY
  WITH report_stats AS (
    SELECT
      r.report_id,
      r.bill_ids,
      r.created_at
    FROM rs_analysis_reports r
    WHERE r.person_id = p_person_id
      AND r.session_id = p_session_id
  ),
  aggregated AS (
    SELECT
      ARRAY_AGG(DISTINCT bill_id ORDER BY bill_id) as all_bill_ids,
      COUNT(DISTINCT report_id)::INT as total_reports,
      MAX(created_at) as latest_analysis
    FROM report_stats,
    LATERAL UNNEST(
      CASE
        WHEN bill_ids IS NOT NULL AND array_length(bill_ids, 1) > 0
        THEN bill_ids
        ELSE ARRAY[]::INT[]
      END
    ) AS bill_id
  )
  SELECT
    COALESCE(array_length(all_bill_ids, 1), 0)::INT as analyzed_bills,
    COALESCE(total_reports, 0)::INT as report_count,
    latest_analysis as last_analysis,
    COALESCE(all_bill_ids, ARRAY[]::INT[]) as analyzedBillIds
  FROM aggregated;

  -- If no data found, return empty result
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      0::INT as analyzed_bills,
      0::INT as report_count,
      NULL::TIMESTAMP WITH TIME ZONE as last_analysis,
      ARRAY[]::INT[] as analyzedBillIds;
  END IF;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_analyzed_bills_stats(BIGINT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_analyzed_bills_stats(BIGINT, INT) TO anon;
GRANT EXECUTE ON FUNCTION get_analyzed_bills_stats(BIGINT, INT) TO service_role;