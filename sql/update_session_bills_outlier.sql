-- Drop existing function if exists
DROP FUNCTION IF EXISTS get_session_bills(BIGINT, DATE, DATE);

-- Create function to get unique bills with last vote for a person in date range, including outlier detection
CREATE OR REPLACE FUNCTION get_session_bills(
  p_person_id BIGINT,
  p_start_date DATE,
  p_end_date DATE
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
  WITH person_legislators AS (
    -- Get all legislator IDs for this person with their party
    SELECT DISTINCT
      pl.legislator_id,
      l.party
    FROM rs_person_legislators pl
    JOIN legislators l ON l.legislator_id = pl.legislator_id
    WHERE pl.person_id = p_person_id
  ),
  latest_votes AS (
    -- Get the most recent vote for each bill by this person's legislators
    SELECT DISTINCT ON (v.bill_id)
      v.bill_id,
      v.vote as vote_value,
      v.vote_date,
      v.legislator_id,
      pl.party
    FROM votes v
    JOIN person_legislators pl ON pl.legislator_id = v.legislator_id
    WHERE v.vote_date BETWEEN p_start_date AND p_end_date
    AND v.vote IS NOT NULL
    ORDER BY v.bill_id, v.vote_date DESC
  ),
  party_votes AS (
    -- Get party voting breakdown for each bill
    SELECT
      v.bill_id,
      v.vote_date,
      l.party,
      v.vote,
      COUNT(*) as vote_count
    FROM votes v
    JOIN legislators l ON l.legislator_id = v.legislator_id
    WHERE v.vote IS NOT NULL
    AND v.vote IN ('AYE', 'NAY')
    GROUP BY v.bill_id, v.vote_date, l.party, v.vote
  ),
  party_summaries AS (
    -- Calculate party voting summaries
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
      ) as party_votes_str,
      -- Determine majority vote for this party
      CASE
        WHEN SUM(CASE WHEN pv.vote = 'AYE' THEN pv.vote_count ELSE 0 END) >
             SUM(CASE WHEN pv.vote = 'NAY' THEN pv.vote_count ELSE 0 END)
        THEN 'AYE'
        ELSE 'NAY'
      END as party_majority
    FROM party_votes pv
    GROUP BY pv.bill_id, pv.vote_date, pv.party
  )
  SELECT DISTINCT
    b.bill_id::BIGINT,
    b.bill_number,
    b.short_title as bill_title,
    lv.vote_value,
    lv.vote_date,
    -- Check if any of the person's legislators sponsored this bill
    EXISTS (
      SELECT 1
      FROM bill_sponsors bs
      WHERE bs.bill_id = b.bill_id
      AND bs.legislator_id IN (SELECT legislator_id FROM person_legislators)
    ) as is_sponsor,
    b.session_id,
    -- Check if this is an outlier vote
    CASE
      WHEN lv.vote_value IN ('AYE', 'NAY') AND ps.party_majority IS NOT NULL
      THEN lv.vote_value != ps.party_majority
      ELSE FALSE
    END as is_outlier,
    -- Party breakdown (only if outlier)
    CASE
      WHEN lv.vote_value IN ('AYE', 'NAY') AND ps.party_majority IS NOT NULL
           AND lv.vote_value != ps.party_majority
      THEN lv.party || ': ' || COALESCE(ps.party_votes_str, '0Y/0N')
      ELSE NULL
    END as party_breakdown
  FROM bills b
  INNER JOIN latest_votes lv ON b.bill_id = lv.bill_id
  LEFT JOIN party_summaries ps ON ps.bill_id = lv.bill_id
    AND ps.vote_date = lv.vote_date
    AND ps.party = lv.party
  WHERE lv.vote_date BETWEEN p_start_date AND p_end_date
  ORDER BY lv.vote_date DESC, b.bill_number;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_session_bills(BIGINT, DATE, DATE) TO service_role;