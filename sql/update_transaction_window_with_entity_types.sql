-- Update list_donor_transactions_window function to include entity type information
-- This ensures the donor theme analysis has access to proper entity type names

DROP FUNCTION IF EXISTS public.list_donor_transactions_window(
  bigint, integer[], integer, integer[], integer, integer, integer[], text[], boolean, numeric, date, date
);

CREATE OR REPLACE FUNCTION public.list_donor_transactions_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_id                    integer   DEFAULT NULL,
  p_include_transaction_entity_ids integer[] DEFAULT NULL,
  p_days_before                   integer   DEFAULT 90,  -- 90 days before session start
  p_days_after                    integer   DEFAULT 45,  -- 45 days after session start
  p_exclude_entity_ids            integer[] DEFAULT ARRAY[-1, -2],
  p_exclude_name_patterns         text[]    DEFAULT ARRAY['citizens clean election%', 'multiple contributor%'],
  p_exclude_self_committees       boolean   DEFAULT TRUE,
  p_min_amount                    numeric   DEFAULT 0,
  p_from                          date      DEFAULT NULL,
  p_to                            date      DEFAULT NULL
)
RETURNS TABLE (
  public_transaction_id      bigint,
  transaction_id             bigint,
  transaction_date           date,
  transaction_entity_id      integer,
  transaction_entity_name    character varying,
  amount                     numeric,
  recipient_entity_id        integer,
  recipient_name             character varying,
  transaction_employer       character varying,
  transaction_occupation     character varying,
  transaction_entity_type_id integer,
  entity_type_name           character varying
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_entity_ids integer[];
  v_from_date date;
  v_to_date date;
BEGIN
  -- Get entity IDs from person_id if provided
  IF p_person_id IS NOT NULL THEN
    SELECT COALESCE(m.all_entity_ids, ARRAY[]::integer[]) INTO v_entity_ids
    FROM mv_entities_search m
    WHERE m.person_id = p_person_id;

    -- Add any additional recipient entity IDs
    IF p_recipient_entity_ids IS NOT NULL THEN
      v_entity_ids := v_entity_ids || p_recipient_entity_ids;
    END IF;
  ELSE
    v_entity_ids := COALESCE(p_recipient_entity_ids, ARRAY[]::integer[]);
  END IF;

  -- Get session window dates if session provided
  IF p_session_id IS NOT NULL THEN
    SELECT from_date, to_date INTO v_from_date, v_to_date
    FROM public.session_window(p_session_id, p_days_before, p_days_after);
  ELSE
    v_from_date := p_from;
    v_to_date := p_to;
  END IF;

  -- Return transactions with entity type information
  RETURN QUERY
  SELECT
    t.public_transaction_id,
    t.transaction_id,
    t.transaction_date,
    t.transaction_entity_id,
    d.entity_name,
    t.amount,
    t.entity_id,
    COALESCE(r.primary_candidate_name, r.primary_committee_name),
    t.transaction_employer,
    t.transaction_occupation,
    t.transaction_entity_type_id,
    et.entity_type_name
  FROM public.cf_transactions t
  JOIN public.cf_transaction_entities d ON d.entity_id = t.transaction_entity_id
  LEFT JOIN public.cf_entities r ON r.entity_id = t.entity_id
  LEFT JOIN public.cf_entity_types et ON et.entity_type_id = t.transaction_entity_type_id
  WHERE
    -- Basic filters first (most selective)
    t.transaction_type_disposition_id = 1
    AND t.amount >= p_min_amount

    -- Date filters
    AND (v_from_date IS NULL OR t.transaction_date >= v_from_date)
    AND (v_to_date IS NULL OR t.transaction_date < v_to_date)

    -- Entity filters (use arrays for efficiency)
    AND (
      cardinality(v_entity_ids) = 0
      OR t.entity_id = ANY(v_entity_ids)
    )

    -- Include specific transaction entities if provided
    AND (
      p_include_transaction_entity_ids IS NULL
      OR t.transaction_entity_id = ANY(p_include_transaction_entity_ids)
    )

    -- Exclude specific entities
    AND (
      p_exclude_entity_ids IS NULL
      OR NOT (t.transaction_entity_id = ANY(p_exclude_entity_ids))
    )

    -- Exclude by name patterns (simplified)
    AND (
      p_exclude_name_patterns IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(p_exclude_name_patterns) AS pattern
        WHERE LOWER(d.entity_name) LIKE LOWER(pattern)
      )
    )

    -- Self-committee exclusion
    AND (
      NOT p_exclude_self_committees
      OR cardinality(v_entity_ids) = 0
      OR NOT (t.transaction_entity_id = ANY(v_entity_ids))
    )

  ORDER BY t.amount DESC, t.transaction_date DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.list_donor_transactions_window(
  bigint, integer[], integer, integer[], integer, integer, integer[], text[], boolean, numeric, date, date
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.list_donor_transactions_window(
  bigint, integer[], integer, integer[], integer, integer[], text[], boolean, numeric, date, date
) TO anon;

GRANT EXECUTE ON FUNCTION public.list_donor_transactions_window(
  bigint, integer[], integer, integer[], integer, integer[], text[], boolean, numeric, date, date
) TO service_role;