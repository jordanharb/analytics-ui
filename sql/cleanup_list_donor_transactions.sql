-- Clean up duplicate list_donor_transactions_window functions
-- Keep the version with people_id support and drop the old one

-- Drop the old version (without people_id)
DROP FUNCTION IF EXISTS public.list_donor_transactions_window(
  integer[], integer, integer, integer, date, date, numeric, integer[], integer[], text[], boolean
);

-- Ensure we have only one version with people_id support and optimized defaults
DROP FUNCTION IF EXISTS public.list_donor_transactions_window(
  bigint, integer[], integer, integer[], integer, integer, integer[], text[], boolean, numeric, date, date
);

CREATE OR REPLACE FUNCTION public.list_donor_transactions_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_id                    integer   DEFAULT NULL,
  p_include_transaction_entity_ids integer[] DEFAULT NULL,
  p_days_before                   integer   DEFAULT 90,  -- Changed to 90 before as requested
  p_days_after                    integer   DEFAULT 45,  -- Keep 45 after as requested
  p_exclude_entity_ids            integer[] DEFAULT ARRAY[-1, -2],
  p_exclude_name_patterns         text[]    DEFAULT ARRAY['citizens clean election%', 'multiple contributor%'],
  p_exclude_self_committees       boolean   DEFAULT TRUE,
  p_min_amount                    numeric   DEFAULT 0,
  p_from                          date      DEFAULT NULL,
  p_to                            date      DEFAULT NULL
)
RETURNS TABLE (
  public_transaction_id   bigint,
  transaction_id          bigint,
  transaction_date        date,
  transaction_entity_id   integer,
  transaction_entity_name character varying,  -- Match actual database type
  amount                  numeric,
  recipient_entity_id     integer,
  recipient_name          character varying   -- Match actual database type
)
LANGUAGE sql
STABLE
AS $$
WITH
person_entities AS (
  -- Get all entity IDs for this person if person_id provided
  SELECT UNNEST(COALESCE(
    CASE WHEN p_person_id IS NOT NULL THEN
      (SELECT COALESCE(m.all_entity_ids, ARRAY[]::integer[])
       FROM mv_entities_search m
       WHERE m.person_id = p_person_id)
    ELSE ARRAY[]::integer[]
    END,
    ARRAY[]::integer[]
  ) || COALESCE(p_recipient_entity_ids, ARRAY[]::integer[])) AS recipient_entity_id
),
bounds AS (
  -- produce exactly one row: either NULLs (if no session) or the session window
  SELECT * FROM (SELECT NULL::date AS from_date, NULL::date AS to_date) z
  WHERE p_session_id IS NULL
  UNION ALL
  SELECT sw.from_date, sw.to_date
  FROM public.session_window(p_session_id, p_days_before, p_days_after) sw
  WHERE p_session_id IS NOT NULL
),
recipients AS (
  SELECT recipient_entity_id FROM person_entities
  WHERE recipient_entity_id IS NOT NULL
),
includes AS (
  SELECT unnest(p_include_transaction_entity_ids) AS transaction_entity_id
),
excl_ids AS (
  SELECT unnest(p_exclude_entity_ids) AS entity_id
),
excl_patterns AS (
  -- wrap patterns with %...% and lowercase once; if NULL, yields zero rows
  SELECT '%' || LOWER(p) || '%' AS pat
  FROM unnest(COALESCE(p_exclude_name_patterns, ARRAY[]::text[])) AS u(p)
),
win AS (
  SELECT
    t.public_transaction_id,
    t.transaction_id,
    t.transaction_date,
    t.transaction_entity_id,
    d.entity_name AS transaction_entity_name,
    t.amount,
    t.entity_id AS recipient_entity_id,
    r.primary_candidate_name AS recipient_name
  FROM public.cf_transactions t
  JOIN public.cf_transaction_entities d ON d.entity_id = t.transaction_entity_id
  LEFT JOIN public.cf_entities r ON r.entity_id = t.entity_id
  WHERE t.transaction_type_disposition_id = 1

    -- require at least some window to be defined (session or from/to)
    AND (p_from IS NOT NULL OR p_to IS NOT NULL OR p_session_id IS NOT NULL)

    -- recipient filter via semi-join (only if provided)
    AND (
      (p_recipient_entity_ids IS NULL AND p_person_id IS NULL)
      OR EXISTS (
        SELECT 1 FROM recipients rr
        WHERE rr.recipient_entity_id = t.entity_id
      )
    )

    -- include specific counterparty entity_ids (only if provided)
    AND (
      p_include_transaction_entity_ids IS NULL
      OR EXISTS (
        SELECT 1 FROM includes i
        WHERE i.transaction_entity_id = t.transaction_entity_id
      )
    )

    -- session window bounds (only if provided)
    AND (
      p_session_id IS NULL
      OR EXISTS (
        SELECT 1 FROM bounds b
        WHERE t.transaction_date >= b.from_date
          AND t.transaction_date <  b.to_date
      )
    )

    -- explicit from/to (if provided)
    AND (p_from IS NULL OR t.transaction_date >= p_from)
    AND (p_to   IS NULL OR t.transaction_date <  p_to)

    -- minimum amount
    AND t.amount >= p_min_amount
)
SELECT *
FROM win w
WHERE
  -- exclude by entity ids
  (
    p_exclude_entity_ids IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM excl_ids x WHERE x.entity_id = w.transaction_entity_id
    )
  )
  -- exclude by name patterns (case-insensitive contains)
  AND NOT EXISTS (
    SELECT 1 FROM excl_patterns ep
    WHERE LOWER(w.transaction_entity_name) LIKE ep.pat
  )
  -- exclude self-committees if requested
  AND (
    NOT p_exclude_self_committees
    OR (p_recipient_entity_ids IS NULL AND p_person_id IS NULL)
    OR NOT EXISTS (
      SELECT 1 FROM recipients rr
      WHERE rr.recipient_entity_id = w.transaction_entity_id
    )
  )
ORDER BY w.amount DESC, w.transaction_date DESC;
$$;