-- Replace get_session_bills to accept multiple session IDs and compute date ranges automatically
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, INT[]);
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, DATE, DATE);

CREATE OR REPLACE FUNCTION get_session_bills(
  p_person_id BIGINT,
  p_session_ids INT[]
)
RETURNS TABLE (
  bill_id BIGINT,
  bill_number VARCHAR,
  bill_title TEXT,
  vote_value VARCHAR,
  vote_date DATE,
  is_sponsor BOOLEAN,
  session_id INT,
  is_outlier BOOLEAN,
  party_breakdown TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH session_bounds AS (
    SELECT
      COALESCE(MIN(v.vote_date), MIN(s.start_date)) AS min_start,
      COALESCE(MAX(v.vote_date), MAX(s.end_date))   AS max_end
    FROM sessions s
    LEFT JOIN bills b ON b.session_id = s.session_id
    LEFT JOIN votes v ON v.bill_id = b.bill_id AND v.vote_date IS NOT NULL
    WHERE s.session_id = ANY(p_session_ids)
  ),
  person_legislators AS (
    SELECT DISTINCT
      pl.legislator_id,
      l.party
    FROM rs_person_legislators pl
    JOIN legislators l ON l.legislator_id = pl.legislator_id
    WHERE pl.person_id = p_person_id
  ),
  latest_votes AS (
    SELECT DISTINCT ON (v.bill_id)
      v.bill_id,
      v.vote AS vote_value,
      v.vote_date,
      v.legislator_id,
      pl.party
    FROM votes v
    JOIN person_legislators pl ON pl.legislator_id = v.legislator_id
    JOIN session_bounds sb ON TRUE
    WHERE v.vote IS NOT NULL
      AND v.vote_date BETWEEN sb.min_start AND sb.max_end
    ORDER BY v.bill_id, v.vote_date DESC
  ),
  party_votes AS (
    SELECT
      v.bill_id,
      v.vote_date,
      l.party,
      v.vote,
      COUNT(*) AS vote_count
    FROM votes v
    JOIN legislators l ON l.legislator_id = v.legislator_id
    WHERE v.vote IS NOT NULL
      AND v.vote IN ('AYE', 'NAY')
    GROUP BY v.bill_id, v.vote_date, l.party, v.vote
  ),
  party_summaries AS (
    SELECT
      pv.bill_id,
      pv.vote_date,
      pv.party,
      STRING_AGG(
        CASE
          WHEN pv.vote = 'AYE' THEN pv.vote_count || 'Y'
          WHEN pv.vote = 'NAY' THEN pv.vote_count || 'N'
        END,
        '/' ORDER BY pv.vote DESC
      ) AS party_votes_str,
      CASE
        WHEN SUM(CASE WHEN pv.vote = 'AYE' THEN pv.vote_count ELSE 0 END) >
             SUM(CASE WHEN pv.vote = 'NAY' THEN pv.vote_count ELSE 0 END)
        THEN 'AYE'
        ELSE 'NAY'
      END AS party_majority
    FROM party_votes pv
    GROUP BY pv.bill_id, pv.vote_date, pv.party
  )
  SELECT DISTINCT
    b.bill_id::BIGINT,
    b.bill_number,
    COALESCE(b.short_title, b.now_title, b.description, '') AS bill_title,
    lv.vote_value,
    lv.vote_date,
    EXISTS (
      SELECT 1
      FROM bill_sponsors bs
      WHERE bs.bill_id = b.bill_id
        AND bs.legislator_id IN (SELECT legislator_id FROM person_legislators)
    ) AS is_sponsor,
    b.session_id,
    CASE
      WHEN lv.vote_value IN ('AYE', 'NAY') AND ps.party_majority IS NOT NULL
        THEN lv.vote_value <> ps.party_majority
      ELSE FALSE
    END AS is_outlier,
    CASE
      WHEN lv.vote_value IN ('AYE', 'NAY') AND ps.party_majority IS NOT NULL
           AND lv.vote_value <> ps.party_majority
        THEN lv.party || ': ' || COALESCE(ps.party_votes_str, '0Y/0N')
      ELSE NULL
    END AS party_breakdown
  FROM bills b
  JOIN latest_votes lv ON b.bill_id = lv.bill_id
  LEFT JOIN party_summaries ps ON ps.bill_id = lv.bill_id
    AND ps.vote_date = lv.vote_date
    AND ps.party = lv.party
  WHERE b.session_id = ANY(p_session_ids)
  ORDER BY lv.vote_date DESC, b.bill_number;
$$;

GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT[]) TO anon;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, INT[]) TO service_role;
