-- Fix search_donor_totals_window with proper entity types and performance
-- Combines the simple single-session performance of the reverted version
-- with the entity type information from the complex version

DROP FUNCTION IF EXISTS public.search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer);

CREATE OR REPLACE FUNCTION public.search_donor_totals_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_id                    integer   DEFAULT NULL,
  p_days_before                   integer   DEFAULT 90,
  p_days_after                    integer   DEFAULT 45,
  p_group_numbers                 integer[] DEFAULT NULL,
  p_query_vec                     vector    DEFAULT NULL,
  p_min_amount                    numeric   DEFAULT 0,
  p_from                          date      DEFAULT NULL,
  p_to                            date      DEFAULT NULL,
  p_limit                         integer   DEFAULT 100
)
RETURNS TABLE (
  transaction_entity_id integer,
  entity_name character varying,
  total_to_recipient numeric,
  donation_count bigint,
  best_match double precision,
  top_employer text,
  top_occupation text,
  entity_type_id integer,
  entity_type_name character varying
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_from date;
  v_to   date;
  v_entity_ids integer[];
BEGIN
  -- Get entity IDs from person_id if provided
  IF p_person_id IS NOT NULL THEN
    SELECT m.all_entity_ids INTO v_entity_ids
    FROM mv_entities_search m
    WHERE m.person_id = p_person_id;

    -- Early return if person has no entity IDs (legislators with no campaign finance data)
    IF v_entity_ids IS NULL OR array_length(v_entity_ids, 1) = 0 THEN
      RETURN;
    END IF;

    -- Combine with any additionally specified entity IDs
    IF p_recipient_entity_ids IS NOT NULL THEN
      v_entity_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(v_entity_ids, ARRAY[]::integer[]) || p_recipient_entity_ids));
    END IF;
  ELSE
    v_entity_ids := p_recipient_entity_ids;
  END IF;

  -- Use session_window for date calculation (now fixed to work properly)
  IF p_session_id IS NOT NULL THEN
    SELECT from_date, to_date INTO v_from, v_to
    FROM public.session_window(p_session_id, p_days_before, p_days_after);
  ELSE
    v_from := p_from;
    v_to   := p_to;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT t.*
    FROM public.cf_transactions t
    WHERE t.transaction_type_disposition_id = 1                      -- donations/income only
      AND (v_from IS NULL OR t.transaction_date >= v_from)
      AND (v_to   IS NULL OR t.transaction_date <  v_to)
      AND (v_entity_ids IS NULL OR t.entity_id = ANY(v_entity_ids))
      AND (p_group_numbers IS NULL OR t.transaction_group_number = ANY(p_group_numbers))
      AND t.amount >= p_min_amount
      -- if you want to ensure we only use rows with vectors when a query vec is present:
      AND (p_query_vec IS NULL OR t.embedding IS NOT NULL)
  ),
  agg AS (
    SELECT
      b.transaction_entity_id,
      SUM(b.amount)        AS total_to_recipient,
      COUNT(*)             AS donation_count,
      MAX(CASE WHEN p_query_vec IS NULL THEN NULL::double precision
               ELSE (1 - (b.embedding <=> p_query_vec))::double precision END) AS best_match
    FROM base b
    GROUP BY b.transaction_entity_id
  ),
  modes AS (
    -- pick a top employer/occupation for quick theming
    SELECT
      b.transaction_entity_id,
      (SELECT mode() WITHIN GROUP (ORDER BY NULLIF(b2.transaction_employer, ''))
       FROM base b2
       WHERE b2.transaction_entity_id = b.transaction_entity_id)::text AS top_employer,
      (SELECT mode() WITHIN GROUP (ORDER BY NULLIF(b2.transaction_occupation,''))
       FROM base b2
       WHERE b2.transaction_entity_id = b.transaction_entity_id)::text AS top_occupation
    FROM base b
    GROUP BY b.transaction_entity_id
  ),
  with_entity_details AS (
    SELECT
      a.transaction_entity_id,
      COALESCE(e.entity_name, 'Unknown Entity') AS entity_name,
      a.total_to_recipient,
      a.donation_count,
      a.best_match,
      m.top_employer,
      m.top_occupation,
      -- Get entity type information from correct schema
      COALESCE(e.entity_type_id, 1) AS entity_type_id,
      COALESCE(et.entity_type_name, 'Unknown') AS entity_type_name
    FROM agg a
    LEFT JOIN public.cf_transaction_entities e ON e.entity_id = a.transaction_entity_id
    LEFT JOIN public.cf_entity_types et ON e.entity_type_id = et.entity_type_id
    LEFT JOIN modes m ON m.transaction_entity_id = a.transaction_entity_id
  )
  SELECT
    wed.transaction_entity_id,
    wed.entity_name,
    wed.total_to_recipient,
    wed.donation_count,
    wed.best_match,
    wed.top_employer,
    wed.top_occupation,
    wed.entity_type_id,
    wed.entity_type_name
  FROM with_entity_details wed
  ORDER BY
    CASE WHEN p_query_vec IS NULL THEN wed.total_to_recipient ELSE wed.best_match END DESC NULLS LAST,
    wed.total_to_recipient DESC
  LIMIT p_limit;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer) TO anon;
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer) TO service_role;