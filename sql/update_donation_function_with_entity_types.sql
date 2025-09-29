-- Update get_legislator_donations function to include entity type names
-- This adds entity_type_id and entity_type_name fields to the donation results

DROP FUNCTION IF EXISTS public.get_legislator_donations(BIGINT, DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_legislator_donations(
  p_person_id BIGINT,
  p_start_date DATE,  -- Session start minus 90 days
  p_end_date DATE     -- Session start plus 45 days
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
  -- Filter for contributions received only (disposition 1)
  AND d.transaction_type_disposition_id = 1
  -- Date range filter
  AND d.donation_date BETWEEN p_start_date AND p_end_date
  -- Minimum amount filter
  AND d.donation_amt >= 100
  ORDER BY d.donation_date DESC;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_legislator_donations(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_legislator_donations(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION public.get_legislator_donations(BIGINT, DATE, DATE) TO service_role;

-- Test the function
-- SELECT * FROM get_legislator_donations(126, '2017-01-01', '2018-12-31') LIMIT 10;