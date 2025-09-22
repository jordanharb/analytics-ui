-- Drop existing function
DROP FUNCTION IF EXISTS get_legislator_donations(BIGINT, DATE, DATE);

-- Create improved function for political donations using actual entity type IDs
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
  is_pac BOOLEAN,
  is_corporate BOOLEAN,
  entity_type_id INT
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
    d.is_pac,
    d.is_corporate,
    er.office_type_id as entity_type_id
  FROM cf_donations d
  INNER JOIN cf_entities e ON d.entity_id = e.entity_id
  LEFT JOIN cf_entity_records er ON d.record_id = er.record_id
  LEFT JOIN cf_transaction_entities te ON d.donor_name = te.entity_name
  WHERE d.entity_id IN (
    -- Get all campaign finance entities for this person
    SELECT DISTINCT pce.entity_id
    FROM rs_person_cf_entities pce
    WHERE pce.person_id = p_person_id
  )
  AND d.donation_date BETWEEN p_start_date AND p_end_date
  AND d.donation_amt >= 100  -- Filter out small donations
  AND (
    -- Political entity type IDs based on the CSV
    er.office_type_id IN (
      3,   -- Business
      15,  -- Support/Oppose (Candidate)
      16,  -- Independent Exp. (Standing) (Multicandidate PAC)
      19,  -- Segregated Fund
      20,  -- Segregated Fund (Multicandidate PAC)
      21,  -- Segregated Fund (Standing)
      22,  -- Segregated Fund (Standing) (Multicandidate PAC)
      23,  -- Independent Expenditures
      24,  -- Independent Expenditures (Multicandidate PAC)
      27,  -- Political Organization
      29,  -- Political Party
      30,  -- Political Party (Standing)
      35,  -- Non-Arizona Committee
      37,  -- Independent Expenditures (Corp/LLC/Labor Org)
      39,  -- Political Action Committee
      40,  -- Political Action Committee (Standing)
      41,  -- Political Action Committee (Mega)
      42,  -- Political Action Committee (Mega Standing)
      43,  -- Partnership
      44,  -- Business Vendor
      45,  -- Corps/LLCs as Contributors
      46,  -- Labor Orgs as Contributors
      47,  -- Non-Arizona Candidate Committee
      48,  -- Non-Arizona PAC
      49   -- Non-Arizona Party
    )
    OR te.entity_type_id IN (
      3, 15, 16, 19, 20, 21, 22, 23, 24, 27, 29, 30, 35, 37, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49
    )
    -- Also include based on keywords
    OR d.is_pac = true
    OR d.is_corporate = true
    OR LOWER(d.donor_occupation) SIMILAR TO '%(lobbyist|director|ceo|chief executive|president|chairman|board member|executive|government|political|consultant|strategist)%'
    OR LOWER(d.donor_employer) SIMILAR TO '%(pac|political|committee|party|lobby|government|consulting|strategies)%'
  )
  ORDER BY d.donation_amt DESC, d.donation_date DESC
  LIMIT 5000;  -- Limit to prevent timeout
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO service_role;