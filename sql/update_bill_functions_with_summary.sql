-- Update bill functions to include bill_summary and add array version
-- This allows Gemini to get bill summaries directly from search results
-- and call get_bill_texts_array for full text when needed

-- Update search_bills_for_legislator_optimized to include bill_summary
DROP FUNCTION IF EXISTS public.search_bills_for_legislator_optimized(bigint, integer, text[], vector[], double precision, integer, integer);

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
  bill_summary   text,
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
  COALESCE(r.bill_summary, '') AS bill_summary,
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

-- Add complete function definition for get_bill_text (single bill)
CREATE OR REPLACE FUNCTION public.get_bill_text(
  p_bill_id integer
)
RETURNS TABLE (
  bill_id       integer,
  bill_number   text,
  session_id    integer,
  summary_title text,
  bill_summary  text,
  full_doc_type text,
  bill_text     text
)
LANGUAGE sql STABLE AS
$$
  SELECT
    b.bill_id,
    b.bill_number::text,
    b.session_id,
    b.summary_title,
    COALESCE(b.bill_summary, '') AS bill_summary,
    b.full_doc_type,
    COALESCE(b.bill_text, '') AS bill_text
  FROM public.bills b
  WHERE b.bill_id = p_bill_id;
$$;

-- Add new array version for batch bill text retrieval
CREATE OR REPLACE FUNCTION public.get_bill_texts_array(
  p_bill_ids integer[]
)
RETURNS TABLE (
  bill_id       integer,
  bill_number   text,
  session_id    integer,
  summary_title text,
  bill_summary  text,
  full_doc_type text,
  bill_text     text
)
LANGUAGE sql STABLE AS
$$
  SELECT
    b.bill_id,
    b.bill_number::text,
    b.session_id,
    b.summary_title,
    COALESCE(b.bill_summary, '') AS bill_summary,
    b.full_doc_type,
    COALESCE(b.bill_text, '') AS bill_text
  FROM public.bills b
  WHERE b.bill_id = ANY(p_bill_ids)
  ORDER BY b.bill_id;
$$;