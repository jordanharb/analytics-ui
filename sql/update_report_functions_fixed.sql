-- Drop existing functions
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, INT);
DROP FUNCTION IF EXISTS get_legislator_donations(BIGINT, DATE, DATE);

-- Create improved function to get bills for sessions with sponsor status
CREATE OR REPLACE FUNCTION get_session_bills(
  p_person_id BIGINT,
  p_session_ids INT[]  -- Array of session IDs (for combined or single)
)
RETURNS TABLE (
  bill_id INT,
  bill_number VARCHAR,
  short_title TEXT,
  description TEXT,
  vote VARCHAR,
  vote_date DATE,
  is_sponsor BOOLEAN
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
    -- Get the latest vote for each bill by this person's legislators
    SELECT DISTINCT ON (b.bill_id)
      b.bill_id,
      b.bill_number,
      b.short_title,
      b.description,
      v.vote,
      v.vote_date,
      b.session_id
    FROM bills b
    INNER JOIN votes v ON v.bill_id = b.bill_id
    INNER JOIN person_legislators pl ON v.legislator_id = pl.legislator_id
    WHERE b.session_id = ANY(p_session_ids)
    ORDER BY b.bill_id, v.vote_date DESC
  )
  SELECT
    lv.bill_id::INT,
    lv.bill_number,
    lv.short_title,
    lv.description,
    lv.vote,
    lv.vote_date,
    EXISTS (
      -- Check if any of this person's legislators sponsored this bill
      SELECT 1
      FROM bill_sponsors bs
      INNER JOIN person_legislators pl ON bs.legislator_id = pl.legislator_id
      WHERE bs.bill_id = lv.bill_id
    ) AS is_sponsor
  FROM latest_votes lv
  ORDER BY lv.vote_date DESC, lv.bill_id;
$$;

-- Create improved function for political donations with better filtering
CREATE OR REPLACE FUNCTION get_legislator_donations(
  p_person_id BIGINT,
  p_start_date DATE,  -- Session start minus 100 days
  p_end_date DATE     -- Session end plus 100 days
)
RETURNS TABLE (
  donor_name VARCHAR,
  donor_occupation VARCHAR,
  donor_employer VARCHAR,
  donation_date DATE,
  donation_amt NUMERIC,
  donation_type VARCHAR,
  entity_name VARCHAR,
  entity_type_id INTEGER,
  entity_type_name VARCHAR,
  is_pac BOOLEAN,
  is_corporate BOOLEAN
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
    COALESCE(e.primary_candidate_name, e.primary_committee_name) as entity_name,
    d.entity_type_id,
    et.entity_type_name,
    d.is_pac,
    d.is_corporate
  FROM cf_donations d
  INNER JOIN cf_entities e ON d.entity_id = e.entity_id
  LEFT JOIN cf_entity_records er ON d.record_id = er.record_id
  LEFT JOIN cf_entity_types et ON d.entity_type_id = et.entity_type_id
  WHERE d.entity_id IN (
    -- Get all campaign finance entities for this person
    SELECT DISTINCT pce.entity_id
    FROM rs_person_cf_entities pce
    WHERE pce.person_id = p_person_id
  )
  AND d.donation_date BETWEEN p_start_date AND p_end_date
  AND d.donation_amt >= 100  -- Filter out small donations
  AND (
    -- Political donations filter
    d.is_pac = true
    OR d.is_corporate = true
    OR LOWER(d.donor_occupation) SIMILAR TO '%(lobbyist|director|ceo|chief executive|president|chairman|board member|executive|government|political|consultant|strategist)%'
    OR LOWER(d.donor_employer) SIMILAR TO '%(pac|political|committee|party|lobby|government|consulting|strategies)%'
    OR er.entity_type IN ('PAC', 'Political Action Committee', 'Corporation', 'Business', 'Union', 'Trade Association')
  )
  ORDER BY d.donation_amt DESC, d.donation_date DESC
  LIMIT 5000;  -- Limit to prevent timeout
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT[]) TO anon;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT[]) TO service_role;

GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO service_role;