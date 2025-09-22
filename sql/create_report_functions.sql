-- Create function to get bills for a session that a legislator voted on
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, INT);

CREATE OR REPLACE FUNCTION get_session_bills(
  p_person_id BIGINT,
  p_session_id INT
)
RETURNS TABLE (
  bill_id INT,
  bill_number VARCHAR,
  short_title TEXT,
  description TEXT,
  vote VARCHAR,
  vote_date DATE,
  sponsor_name VARCHAR
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    b.bill_id::INT,
    b.bill_number,
    b.short_title,
    b.description,
    v.vote,
    v.vote_date,
    COALESCE(b.primary_sponsor_name, 'Unknown') as sponsor_name
  FROM bills b
  INNER JOIN votes v ON v.bill_id = b.bill_id
  WHERE b.session_id = p_session_id
    AND v.legislator_id IN (
      -- Get all legislator IDs for this person
      SELECT DISTINCT pl.legislator_id
      FROM rs_person_legislators pl
      WHERE pl.person_id = p_person_id
    )
  ORDER BY v.vote_date DESC, b.bill_id;
$$;

-- Create function to get donations for a legislator
DROP FUNCTION IF EXISTS get_legislator_donations(BIGINT, DATE, DATE);

CREATE OR REPLACE FUNCTION get_legislator_donations(
  p_person_id BIGINT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  donor_name VARCHAR,
  donor_occupation VARCHAR,
  donor_employer VARCHAR,
  donation_date DATE,
  donation_amt NUMERIC,
  donation_type VARCHAR,
  entity_name VARCHAR
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    d.donor_name,
    d.donor_occupation,
    d.donor_employer,
    d.donation_date,
    d.donation_amt,
    d.donation_type,
    COALESCE(e.primary_candidate_name, e.primary_committee_name) as entity_name
  FROM cf_donations d
  INNER JOIN cf_entities e ON d.entity_id = e.entity_id
  WHERE d.entity_id IN (
    -- Get all campaign finance entities for this person
    SELECT DISTINCT pce.entity_id
    FROM rs_person_cf_entities pce
    WHERE pce.person_id = p_person_id
  )
  AND d.donation_date BETWEEN p_start_date AND p_end_date
  AND d.donation_amt > 0
  ORDER BY d.donation_amt DESC, d.donation_date DESC
  LIMIT 10000;  -- Limit to prevent timeout
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT) TO anon;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT) TO service_role;

GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO service_role;