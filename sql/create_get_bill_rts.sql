CREATE OR REPLACE FUNCTION get_bill_rts(p_bill_id BIGINT)
RETURNS TABLE (
  position_id INT,
  entity_name VARCHAR,
  representing VARCHAR,
  "position" VARCHAR,
  submitted_date TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.position_id,
    r.entity_name,
    r.representing,
    r."position",
    r.submitted_date
  FROM rts_positions r
  WHERE r.bill_id = p_bill_id
  ORDER BY r.submitted_date DESC;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_bill_rts(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bill_rts(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION get_bill_rts(BIGINT) TO service_role;
