-- Drop existing function
DROP FUNCTION IF EXISTS get_legislator_donations(BIGINT, DATE, DATE);

-- Create function that includes PACs AND individual lobbyists/executives
CREATE OR REPLACE FUNCTION get_legislator_donations(
  p_person_id BIGINT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  transaction_id BIGINT,
  donor_name TEXT,
  donation_date DATE,
  amount NUMERIC,
  entity_type_id INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    t.transaction_id,
    t.received_from_or_paid_to AS donor_name,
    t.transaction_date AS donation_date,
    t.amount,
    t.entity_type_id
  FROM cf_transactions t
  WHERE t.entity_id IN (
    -- Get all campaign finance entities for this person
    SELECT DISTINCT pce.entity_id
    FROM rs_person_cf_entities pce
    WHERE pce.person_id = p_person_id
  )
  -- Filter for income transactions only (disposition 1 or 2)
  AND t.transaction_type_disposition_id IN (1, 2)
  -- Date range filter
  AND t.transaction_date BETWEEN p_start_date AND p_end_date
  -- Minimum amount filter
  AND t.amount >= 100
  -- Include EITHER political entity types OR individuals with relevant occupations
  AND (
    -- Political entity types (PACs, businesses, etc.)
    t.entity_type_id IN (
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
      48   -- Non-Arizona PAC
    )
    OR
    -- Individual donors with relevant occupations (likely entity_type_id 1 or 2)
    (
      t.entity_type_id IN (1, 2) AND (
        UPPER(t.transaction_occupation) ILIKE '%LOBBYIST%'
        OR UPPER(t.transaction_occupation) ILIKE '%LOBBY%'
        OR UPPER(t.transaction_occupation) ILIKE '%GOVERNMENT%RELATIONS%'
        OR UPPER(t.transaction_occupation) ILIKE '%CONSULTANT%'
        OR UPPER(t.transaction_occupation) ILIKE '%CEO%'
        OR UPPER(t.transaction_occupation) ILIKE '%PRESIDENT%'
        OR UPPER(t.transaction_occupation) ILIKE '%EXECUTIVE%'
        OR UPPER(t.transaction_occupation) ILIKE '%DIRECTOR%'
        OR UPPER(t.transaction_occupation) ILIKE '%OWNER%'
        OR UPPER(t.transaction_occupation) ILIKE '%PARTNER%'
        OR UPPER(t.transaction_occupation) ILIKE '%ATTORNEY%'
        OR UPPER(t.transaction_occupation) ILIKE '%LAWYER%'
        OR UPPER(t.transaction_occupation) ILIKE '%DEVELOPER%'
        OR UPPER(t.transaction_occupation) ILIKE '%CONTRACTOR%'
      )
    )
  )
  ORDER BY t.amount DESC, t.transaction_date DESC
  LIMIT 5000;  -- Limit to prevent timeout
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_legislator_donations(BIGINT, DATE, DATE) TO service_role;

-- Test the function for person 126
SELECT * FROM get_legislator_donations(126, '2017-10-15', '2018-05-05') LIMIT 20;