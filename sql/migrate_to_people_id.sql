-- Migration to People ID Functions
-- This file migrates all legislator-based functions to use people_id instead of legislator_id
-- Date: 2024-09-30

-- ======================================
-- search_bills_for_legislator_optimized
-- ======================================

DROP FUNCTION IF EXISTS public.search_bills_for_legislator_optimized(integer, integer, text[], vector[], double precision, integer, integer);

CREATE OR REPLACE FUNCTION public.search_bills_for_legislator_optimized(
  p_person_id     bigint,
  p_session_id    integer,
  p_search_terms  text[] DEFAULT NULL,
  p_query_vecs    vector[] DEFAULT NULL,
  p_min_text_score double precision DEFAULT 0.30,  -- threshold for vector match
  p_limit         integer DEFAULT 100,
  p_offset        integer DEFAULT 0
)
RETURNS TABLE (
  bill_id        integer,
  session_id     integer,
  bill_number    text,
  short_title    text,
  description    text,
  date_introduced date,
  summary_title  text,
  full_doc_type  text,
  score          double precision,
  vote           text,
  vote_date      date,
  is_sponsor     boolean,
  is_party_outlier boolean,
  party_breakdown jsonb
)
LANGUAGE sql STABLE AS
$$
WITH person_legislators AS (
  -- Get all legislator IDs for this person
  SELECT UNNEST(m.all_legislator_ids) AS legislator_id
  FROM mv_entities_search m
  WHERE m.person_id = p_person_id
),
base AS (
  SELECT
    b.bill_id,
    b.session_id,
    b.bill_number::text,
    b.short_title,
    b.description,
    b.date_introduced,
    b.summary_title,
    b.full_doc_type,

    /* text-term hit if ANY term matches number/title/desc or a sponsor name */
    (
      CASE WHEN p_search_terms IS NULL THEN FALSE
      ELSE EXISTS (
        SELECT 1
        FROM unnest(p_search_terms) AS t(term)
        WHERE
          b.bill_number ILIKE '%' || term || '%'
          OR b.short_title ILIKE '%' || term || '%'
          OR b.description ILIKE '%' || term || '%'
          OR EXISTS (
            SELECT 1
            FROM public.bill_sponsors bs2
            JOIN public.legislators l2 ON l2.legislator_id = bs2.legislator_id
            WHERE bs2.bill_id = b.bill_id
              AND l2.full_name ILIKE '%' || term || '%'
          )
      )
      END
    ) AS term_hit,

    /* vector similarity: take MAX across all query vectors and across summary/full embeddings */
    (
      CASE WHEN p_query_vecs IS NULL THEN 0
      ELSE (
        SELECT MAX(
          GREATEST(
            COALESCE(1 - (b.embedding_summary <=> q), 0),
            COALESCE(1 - (b.embedding_full    <=> q), 0)
          )
        )
        FROM unnest(p_query_vecs) AS q
      )
      END
    ) AS vec_score

  FROM public.bills b
  WHERE b.session_id = p_session_id
    AND EXISTS (
      SELECT 1 FROM public.votes v
      JOIN person_legislators pl ON v.legislator_id = pl.legislator_id
      WHERE v.bill_id = b.bill_id
    )
),
search_results AS (
  SELECT
    base.*,
    (
      (CASE WHEN term_hit THEN 0.4 ELSE 0 END)
      + (0.6 * COALESCE(vec_score, 0))
    )::double precision AS calculated_score
  FROM base
  WHERE
    -- include if ANY text term hit OR ANY vector exceeds threshold
    (p_search_terms IS NOT NULL AND term_hit)
    OR (p_query_vecs IS NOT NULL AND vec_score > p_min_text_score)
),
ranked AS (
  SELECT b.*, sr.calculated_score
  FROM public.bills b
  JOIN search_results sr ON sr.bill_id = b.bill_id
),
latest_vote AS (
  SELECT bill_id, MAX(vote_date) AS latest_vote_date
  FROM public.votes
  GROUP BY bill_id
)
SELECT
  r.bill_id,
  r.session_id,
  r.bill_number::text,
  r.short_title,
  r.description,
  r.date_introduced,
  r.summary_title,
  r.full_doc_type,
  sr.calculated_score AS score,

  lv_leg.vote,
  lv.latest_vote_date AS vote_date,

  EXISTS (
    SELECT 1 FROM public.bill_sponsors bs
    JOIN person_legislators pl ON bs.legislator_id = pl.legislator_id
    WHERE bs.bill_id = r.bill_id
  ) AS is_sponsor,

  CASE
    WHEN lv_leg.vote IS NULL OR stats.leg_party_mode_vote IS NULL
      THEN FALSE
    ELSE (lv_leg.vote <> stats.leg_party_mode_vote)
  END AS is_party_outlier,

  CASE
    WHEN lv_leg.vote IS NULL OR stats.leg_party_mode_vote IS NULL OR (lv_leg.vote = stats.leg_party_mode_vote)
      THEN NULL
    ELSE stats.party_breakdown
  END AS party_breakdown

FROM ranked r
JOIN search_results sr ON sr.bill_id = r.bill_id
JOIN latest_vote lv ON lv.bill_id = r.bill_id
JOIN mv_entities_search m ON m.person_id = p_person_id
JOIN public.legislators lm ON lm.legislator_id = ANY(m.all_legislator_ids)

LEFT JOIN LATERAL (
  SELECT v.vote, v.legislator_id
  FROM public.votes v
  JOIN person_legislators pl ON v.legislator_id = pl.legislator_id
  WHERE v.bill_id = r.bill_id
    AND v.vote_date = lv.latest_vote_date
  ORDER BY v.vote_id DESC
  LIMIT 1
) lv_leg ON TRUE

LEFT JOIN LATERAL (
  WITH counts AS (
    SELECT l.party, v.vote, COUNT(*) AS cnt
    FROM public.votes v
    JOIN public.legislators l ON l.legislator_id = v.legislator_id
    WHERE v.bill_id = r.bill_id
      AND v.vote_date = lv.latest_vote_date
      AND l.party IS NOT NULL
    GROUP BY l.party, v.vote
  ),
  per_party AS (
    SELECT party, jsonb_object_agg(vote, cnt ORDER BY vote) AS votes_json
    FROM counts
    GROUP BY party
  ),
  party_mode AS (
    SELECT party, vote AS mode_vote
    FROM (
      SELECT party, vote, cnt,
             row_number() OVER (PARTITION BY party ORDER BY cnt DESC, vote) AS rn
      FROM counts
    ) s
    WHERE rn = 1
  )
  SELECT
    (SELECT mode_vote FROM party_mode WHERE party = lm.party LIMIT 1) AS leg_party_mode_vote,
    (SELECT jsonb_object_agg(pp.party, pp.votes_json) FROM per_party pp) AS party_breakdown
) stats ON TRUE

ORDER BY sr.calculated_score DESC, r.date_introduced DESC NULLS LAST
LIMIT p_limit
OFFSET p_offset;
$$;

-- ======================================
-- search_donor_totals_window
-- ======================================

DROP FUNCTION IF EXISTS public.search_donor_totals_window(integer[], integer, integer, integer, text[], vector, numeric, date, date, integer);

CREATE OR REPLACE FUNCTION public.search_donor_totals_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_id                    integer   DEFAULT NULL,
  p_days_before                   integer   DEFAULT 45,
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
  entity_name text,
  total_to_recipient numeric,
  donation_count bigint,
  best_match real,
  top_employer text,
  top_occupation text
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

    -- Combine with any additionally specified entity IDs
    IF p_recipient_entity_ids IS NOT NULL THEN
      v_entity_ids := ARRAY(SELECT DISTINCT unnest(COALESCE(v_entity_ids, ARRAY[]::integer[]) || p_recipient_entity_ids));
    END IF;
  ELSE
    v_entity_ids := p_recipient_entity_ids;
  END IF;

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
      MAX(CASE WHEN p_query_vec IS NULL THEN NULL::real
               ELSE 1 - (b.embedding <=> p_query_vec) END) AS best_match
    FROM base b
    GROUP BY b.transaction_entity_id
  ),
  modes AS (
    -- pick a top employer/occupation for quick theming
    SELECT
      b.transaction_entity_id,
      mode() WITHIN GROUP (ORDER BY NULLIF(b.transaction_employer, '')) AS top_employer,
      mode() WITHIN GROUP (ORDER BY NULLIF(b.transaction_occupation,'')) AS top_occupation
    FROM base b
    GROUP BY b.transaction_entity_id
  )
  SELECT
    a.transaction_entity_id,
    e.entity_name,
    a.total_to_recipient,
    a.donation_count,
    a.best_match,
    m.top_employer,
    m.top_occupation
  FROM agg a
  JOIN public.cf_transaction_entities e ON e.entity_id = a.transaction_entity_id
  LEFT JOIN modes m USING (transaction_entity_id)
  ORDER BY
    (a.best_match IS NULL) ASC,  -- put vector-scored first if present
    a.best_match DESC NULLS LAST,
    a.total_to_recipient DESC
  LIMIT p_limit;
END;
$$;

-- ======================================
-- list_donor_transactions_window
-- ======================================

DROP FUNCTION IF EXISTS public.list_donor_transactions_window(integer[], integer, integer[], integer, integer, integer[], text[], boolean, numeric, date, date);

CREATE OR REPLACE FUNCTION public.list_donor_transactions_window(
  p_person_id                     bigint    DEFAULT NULL,
  p_recipient_entity_ids          integer[] DEFAULT NULL,
  p_session_id                    integer   DEFAULT NULL,
  p_include_transaction_entity_ids integer[] DEFAULT NULL,
  p_days_before                   integer   DEFAULT 45,
  p_days_after                    integer   DEFAULT 45,
  p_exclude_entity_ids            integer[] DEFAULT NULL,
  p_exclude_name_patterns         text[]    DEFAULT NULL,
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
  transaction_entity_name text,
  amount                  numeric,
  recipient_entity_id     integer,
  recipient_name          text
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