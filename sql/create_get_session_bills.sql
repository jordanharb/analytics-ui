-- Drop existing function if exists (both signatures)
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, INT[]);
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, DATE, DATE);

-- Create function to get unique bills with last vote for a person in date range
CREATE OR REPLACE FUNCTION get_session_bills(
  p_person_id BIGINT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  bill_id BIGINT,
  bill_number VARCHAR,
  bill_title TEXT,
  vote_value VARCHAR,
  vote_date DATE,
  is_sponsor BOOLEAN,
  session_id INT
)
LANGUAGE sql
STABLE
AS $$
  WITH person_legislators AS (
    -- Get all legislator IDs for this person
    SELECT DISTINCT legislator_id
    FROM rs_person_legislators
    WHERE person_id = p_person_id
  ),
  latest_votes AS (
    -- Get the most recent vote for each bill by this person's legislators
    SELECT DISTINCT ON (v.bill_id)
      v.bill_id,
      v.vote as vote_value,
      v.vote_date,
      v.legislator_id
    FROM votes v
    WHERE v.legislator_id IN (SELECT legislator_id FROM person_legislators)
    AND v.vote_date BETWEEN p_start_date AND p_end_date
    AND v.vote IS NOT NULL
    ORDER BY v.bill_id, v.vote_date DESC
  )
  SELECT DISTINCT
    b.bill_id::BIGINT,
    b.bill_number,
    b.short_title as bill_title,
    lv.vote_value,
    lv.vote_date,
    -- Check if any of the person's legislators sponsored this bill
    EXISTS (
      SELECT 1
      FROM bill_sponsors bs
      WHERE bs.bill_id = b.bill_id
      AND bs.legislator_id IN (SELECT legislator_id FROM person_legislators)
    ) as is_sponsor,
    b.session_id
  FROM bills b
  INNER JOIN latest_votes lv ON b.bill_id = lv.bill_id
  WHERE lv.vote_date BETWEEN p_start_date AND p_end_date
  ORDER BY lv.vote_date DESC, b.bill_number;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, DATE, DATE) TO service_role;