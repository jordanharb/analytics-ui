CREATE OR REPLACE FUNCTION get_bill_details(p_bill_id BIGINT)
RETURNS TABLE (
  bill_id BIGINT,
  bill_number VARCHAR,
  bill_text TEXT,
  bill_summary TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    b.bill_id::BIGINT,
    b.bill_number,
    b.bill_text,
    b.bill_summary
  FROM bills b
  WHERE b.bill_id = p_bill_id;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_bill_details(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bill_details(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION get_bill_details(BIGINT) TO service_role;