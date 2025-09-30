-- Fix search_donor_totals_window to calculate session dates properly like search_people_with_sessions
-- This replaces the broken session_window() function with direct session date calculation

DROP FUNCTION IF EXISTS public.search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer);
DROP FUNCTION IF EXISTS public.search_donor_totals_window(bigint, integer[], integer[], integer, integer, integer[], vector, numeric, date, date, integer);

CREATE OR REPLACE FUNCTION public.search_donor_totals_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_ids                   integer[] DEFAULT NULL,  -- Changed from single session_id to array
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
  v_session_ids integer[];
BEGIN
  -- Get entity IDs from person_id if provided
  IF p_person_id IS NOT NULL THEN
    SELECT m.all_entity_ids INTO v_entity_ids
    FROM mv_entities_search m
    WHERE m.person_id = p_person_id;

    -- Combine with any additionally specified entity IDs
    IF p_recipient_entity_ids IS NOT NULL THEN
      v_entity_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(v_entity_ids, ARRAY[]::integer[]) || p_recipient_entity_ids));
    END IF;
  ELSE
    v_entity_ids := p_recipient_entity_ids;
  END IF;

  -- Handle session IDs
  IF p_session_ids IS NOT NULL AND array_length(p_session_ids, 1) > 0 THEN
    v_session_ids := p_session_ids;
  ELSIF p_person_id IS NOT NULL THEN
    -- Get all session IDs for this person from the materialized view
    SELECT m.all_session_ids INTO v_session_ids
    FROM mv_entities_search m
    WHERE m.person_id = p_person_id;
  END IF;

  -- Calculate date window based on session vote dates (like search_people_with_sessions approach)
  IF v_session_ids IS NOT NULL AND array_length(v_session_ids, 1) > 0 THEN
    -- Get the earliest and latest vote dates across all specified sessions
    WITH session_vote_dates AS (
      SELECT
        MIN(v.vote_date) AS earliest_vote_date,
        MAX(v.vote_date) AS latest_vote_date
      FROM votes v
      JOIN bills b ON v.bill_id = b.bill_id
      WHERE b.session_id = ANY(v_session_ids)
        AND v.vote_date IS NOT NULL
    )
    SELECT
      (earliest_vote_date - INTERVAL '1 day' * p_days_before)::date,
      (latest_vote_date + INTERVAL '1 day' * p_days_after)::date
    INTO v_from, v_to
    FROM session_vote_dates
    WHERE earliest_vote_date IS NOT NULL AND latest_vote_date IS NOT NULL;

    -- Fallback: if no votes found, use session start/end dates
    IF v_from IS NULL OR v_to IS NULL THEN
      WITH session_dates AS (
        SELECT
          MIN(s.start_date) AS earliest_start,
          MAX(s.end_date) AS latest_end
        FROM sessions s
        WHERE s.session_id = ANY(v_session_ids)
          AND s.start_date IS NOT NULL
          AND s.end_date IS NOT NULL
      )
      SELECT
        (earliest_start - INTERVAL '1 day' * p_days_before)::date,
        (latest_end + INTERVAL '1 day' * p_days_after)::date
      INTO v_from, v_to
      FROM session_dates
      WHERE earliest_start IS NOT NULL AND latest_end IS NOT NULL;
    END IF;
  ELSE
    -- Use explicit date range if provided
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
  with_entity_details AS (
    SELECT
      agg.transaction_entity_id,
      COALESCE(te.entity_name, 'Unknown Entity') AS entity_name,
      agg.total_to_recipient,
      agg.donation_count,
      agg.best_match,

      -- Get top employer and occupation from transactions
      (SELECT mode() WITHIN GROUP (ORDER BY b.transaction_employer)
       FROM base b
       WHERE b.transaction_entity_id = agg.transaction_entity_id
         AND b.transaction_employer IS NOT NULL)::text AS top_employer,

      (SELECT mode() WITHIN GROUP (ORDER BY b.transaction_occupation)
       FROM base b
       WHERE b.transaction_entity_id = agg.transaction_entity_id
         AND b.transaction_occupation IS NOT NULL)::text AS top_occupation,

      -- Get entity type information
      COALESCE(te.entity_type_id, 1) AS entity_type_id,
      COALESCE(et.entity_type_name, 'Unknown') AS entity_type_name

    FROM agg
    LEFT JOIN cf_transaction_entities te ON agg.transaction_entity_id = te.entity_id
    LEFT JOIN cf_entity_types et ON te.entity_type_id = et.entity_type_id
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
END
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer[], integer, integer, integer[], vector, numeric, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer[], integer, integer, integer[], vector, numeric, date, date, integer) TO anon;
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer[], integer, integer, integer[], vector, numeric, date, date, integer) TO service_role;

-- Also create a backward-compatible version that accepts single session_id
CREATE OR REPLACE FUNCTION public.search_donor_totals_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_id                    integer   DEFAULT NULL,  -- Single session_id for compatibility
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
BEGIN
  -- Convert single session_id to array and call the main function
  RETURN QUERY
  SELECT * FROM public.search_donor_totals_window(
    p_person_id := p_person_id,
    p_recipient_entity_ids := p_recipient_entity_ids,
    p_session_ids := CASE WHEN p_session_id IS NULL THEN NULL ELSE ARRAY[p_session_id] END,
    p_days_before := p_days_before,
    p_days_after := p_days_after,
    p_group_numbers := p_group_numbers,
    p_query_vec := p_query_vec,
    p_min_amount := p_min_amount,
    p_from := p_from,
    p_to := p_to,
    p_limit := p_limit
  );
END
$$;

-- Grant permissions for the compatibility version
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer) TO anon;
GRANT EXECUTE ON FUNCTION search_donor_totals_window(bigint, integer[], integer, integer, integer, integer[], vector, numeric, date, date, integer) TO service_role;