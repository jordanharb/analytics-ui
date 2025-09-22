-- People-Centric SQL Functions for Legislature & Campaign Finance Tracker

-- ============================================
-- 1. PEOPLE INDEX (Main listing page)
-- ============================================

-- Materialized view for fast people listing
CREATE MATERIALIZED VIEW IF NOT EXISTS rs_mv_people_legislator_index AS
WITH legislator_positions AS (
  SELECT 
    pl.person_id,
    array_agg(DISTINCT 
      CONCAT(l.body, ' District ', l.district::text, ' (', l.party, ')')
      ORDER BY CONCAT(l.body, ' District ', l.district::text, ' (', l.party, ')')
    ) AS positions_held,
    MAX(l.last_seen_session) AS last_session_id,
    MAX(s.session_name) AS last_session_name,
    COUNT(DISTINCT bs.id) AS total_sponsored,
    COUNT(DISTINCT v.vote_id) AS total_votes
  FROM rs_person_legislators pl
  JOIN legislators l ON l.legislator_id = pl.legislator_id
  LEFT JOIN sessions s ON s.session_id = l.last_seen_session
  LEFT JOIN bill_sponsors bs ON bs.legislator_id = pl.legislator_id
  LEFT JOIN votes v ON v.legislator_id = pl.legislator_id
  GROUP BY pl.person_id
),
finance_summary AS (
  SELECT 
    pe.person_id,
    COUNT(DISTINCT pe.entity_id) AS entity_count,
    COALESCE(SUM(e.total_income_all_records), 0) AS total_raised,
    COALESCE(SUM(e.total_expense_all_records), 0) AS total_spent
  FROM rs_person_cf_entities pe
  JOIN cf_entities e ON e.entity_id = pe.entity_id
  GROUP BY pe.person_id
)
SELECT
  p.person_id,
  p.display_name,
  lp.positions_held,
  lp.last_session_id,
  lp.last_session_name,
  COALESCE(lp.total_sponsored, 0) AS total_sponsored,
  COALESCE(lp.total_votes, 0) AS total_votes,
  COALESCE(fs.entity_count, 0) AS entity_count,
  COALESCE(fs.total_raised, 0) AS total_raised,
  COALESCE(fs.total_spent, 0) AS total_spent,
  CASE 
    WHEN lp.person_id IS NOT NULL THEN 'legislator'
    WHEN fs.person_id IS NOT NULL THEN 'candidate'
    ELSE 'other'
  END AS person_type
FROM rs_people p
LEFT JOIN legislator_positions lp ON lp.person_id = p.person_id
LEFT JOIN finance_summary fs ON fs.person_id = p.person_id;

CREATE UNIQUE INDEX IF NOT EXISTS rs_mv_people_legislator_index_pk 
  ON rs_mv_people_legislator_index (person_id);
CREATE INDEX IF NOT EXISTS rs_mv_people_legislator_index_name 
  ON rs_mv_people_legislator_index USING gin (display_name gin_trgm_ops);

-- RPC wrapper for the materialized view with search
CREATE OR REPLACE FUNCTION rs_legislators_people_index(
  q text DEFAULT '',
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  person_id bigint,
  display_name text,
  positions_held text[],
  last_session_name text,
  total_sponsored bigint,
  total_votes bigint,
  entity_count bigint,
  total_raised numeric,
  total_spent numeric,
  person_type text
) LANGUAGE sql STABLE AS $$
  SELECT 
    person_id,
    display_name,
    positions_held,
    last_session_name,
    total_sponsored,
    total_votes,
    entity_count,
    total_raised,
    total_spent,
    person_type
  FROM rs_mv_people_legislator_index
  WHERE q = '' OR display_name ILIKE '%' || q || '%'
  ORDER BY 
    CASE WHEN person_type = 'legislator' THEN 1 
         WHEN person_type = 'candidate' THEN 2 
         ELSE 3 END,
    display_name
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================
-- 2. PERSON SESSIONS (For vote history tabs)
-- ============================================

CREATE OR REPLACE FUNCTION rs_person_sessions(p_person_id bigint)
RETURNS TABLE (
  session_id int,
  session_name text,
  year int,
  vote_count bigint,
  sponsored_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT
    s.session_id,
    s.session_name,
    s.year,
    COUNT(DISTINCT v.vote_id) AS vote_count,
    COUNT(DISTINCT bs.id) AS sponsored_count
  FROM rs_person_legislators pl
  JOIN legislators l ON l.legislator_id = pl.legislator_id
  JOIN sessions s ON s.session_id BETWEEN 
    COALESCE(l.first_seen_session, 0) AND 
    COALESCE(l.last_seen_session, 99999)
  LEFT JOIN votes v ON v.legislator_id = pl.legislator_id
    AND v.bill_id IN (SELECT bill_id FROM bills WHERE session_id = s.session_id)
  LEFT JOIN bill_sponsors bs ON bs.legislator_id = pl.legislator_id
    AND bs.bill_id IN (SELECT bill_id FROM bills WHERE session_id = s.session_id)
  WHERE pl.person_id = p_person_id
  GROUP BY s.session_id, s.session_name, s.year
  ORDER BY s.year DESC, s.session_id DESC;
$$;

-- ============================================
-- 3. PERSON'S LAST VOTE PER BILL IN SESSION
-- ============================================

CREATE OR REPLACE FUNCTION rs_person_session_bill_last_votes(
  p_person_id bigint,
  p_session_id int,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0,
  q text DEFAULT ''
)
RETURNS TABLE (
  bill_id int,
  bill_number text,
  short_title text,
  latest_vote text,
  latest_vote_date date,
  latest_venue text,
  vote_count int
) LANGUAGE sql STABLE AS $$
  WITH person_bill_votes AS (
    SELECT DISTINCT ON (b.bill_id)
      b.bill_id,
      b.bill_number,
      b.short_title,
      v.vote AS latest_vote,
      v.vote_date AS latest_vote_date,
      v.venue AS latest_venue,
      COUNT(*) OVER (PARTITION BY b.bill_id) AS vote_count
    FROM rs_person_legislators pl
    JOIN votes v ON v.legislator_id = pl.legislator_id
    JOIN bills b ON b.bill_id = v.bill_id
    WHERE pl.person_id = p_person_id
      AND b.session_id = p_session_id
      AND (q = '' OR b.bill_number ILIKE '%' || q || '%' OR b.short_title ILIKE '%' || q || '%')
    ORDER BY b.bill_id, v.vote_date DESC, v.vote_id DESC
  )
  SELECT * FROM person_bill_votes
  ORDER BY latest_vote_date DESC, bill_number
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================
-- 4. PERSON'S FULL VOTE HISTORY ON A BILL
-- ============================================

CREATE OR REPLACE FUNCTION rs_person_bill_vote_history(
  p_person_id bigint,
  p_bill_id int
)
RETURNS TABLE (
  vote_id int,
  vote_date date,
  venue text,
  venue_type text,
  committee_name text,
  vote text,
  vote_number int
) LANGUAGE sql STABLE AS $$
  SELECT 
    v.vote_id,
    v.vote_date,
    v.venue,
    v.venue_type,
    c.committee_name,
    v.vote,
    ROW_NUMBER() OVER (ORDER BY v.vote_date, v.vote_id) AS vote_number
  FROM rs_person_legislators pl
  JOIN votes v ON v.legislator_id = pl.legislator_id
  LEFT JOIN committees c ON c.committee_id = v.committee_id
  WHERE pl.person_id = p_person_id
    AND v.bill_id = p_bill_id
  ORDER BY v.vote_date, v.vote_id;
$$;

-- ============================================
-- 5. BILL FULL ROLL CALL (All legislators)
-- ============================================

CREATE OR REPLACE FUNCTION rs_bill_votes_full(p_bill_id int)
RETURNS TABLE (
  vote_date date,
  venue text,
  venue_type text,
  committee_name text,
  legislator_id int,
  legislator_name text,
  party text,
  vote text,
  person_id bigint
) LANGUAGE sql STABLE AS $$
  SELECT 
    v.vote_date,
    v.venue,
    v.venue_type,
    c.committee_name,
    v.legislator_id,
    l.full_name AS legislator_name,
    l.party,
    v.vote,
    pl.person_id
  FROM votes v
  JOIN legislators l ON l.legislator_id = v.legislator_id
  LEFT JOIN committees c ON c.committee_id = v.committee_id
  LEFT JOIN rs_person_legislators pl ON pl.legislator_id = v.legislator_id
  WHERE v.bill_id = p_bill_id
  ORDER BY v.vote_date, v.venue, l.full_name;
$$;

-- ============================================
-- 6. RTS POSITIONS WITH SEARCH
-- ============================================

CREATE OR REPLACE FUNCTION rs_bill_rts_positions_search(
  p_bill_id int,
  q text DEFAULT '',
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  position_id int,
  entity_name text,
  representing text,
  position text,
  submitted_date timestamptz,
  user_id int,
  person_id bigint
) LANGUAGE sql STABLE AS $$
  SELECT 
    r.position_id,
    r.entity_name,
    r.representing,
    r.position,
    r.submitted_date,
    r.user_id,
    NULL::bigint AS person_id -- TODO: Link RTS users to people
  FROM rts_positions r
  WHERE r.bill_id = p_bill_id
    AND (q = '' OR 
         r.entity_name ILIKE '%' || q || '%' OR 
         r.representing ILIKE '%' || q || '%')
  ORDER BY r.submitted_date DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================
-- 7. PERSON FINANCE OVERVIEW
-- ============================================

CREATE OR REPLACE FUNCTION rs_person_finance_overview(p_person_id bigint)
RETURNS TABLE (
  total_raised numeric,
  total_spent numeric,
  entity_count int,
  transaction_count bigint,
  first_activity date,
  last_activity date,
  entity_details jsonb
) LANGUAGE sql STABLE AS $
  WITH person_entity_details AS (
    SELECT 
      pe.person_id,
      jsonb_agg(jsonb_build_object(
        'entity_id', e.entity_id,
        'display_name', COALESCE(e.primary_candidate_name, e.primary_committee_name),
        'total_raised', e.total_income_all_records,
        'total_spent', e.total_expense_all_records
      ) ORDER BY e.total_income_all_records DESC) FILTER (WHERE e.entity_id IS NOT NULL) AS entity_details_agg,
      COUNT(DISTINCT pe.entity_id) AS entity_count_agg,
      SUM(e.total_income_all_records) AS total_raised_agg,
      SUM(e.total_expense_all_records) AS total_spent_agg
    FROM rs_person_cf_entities pe
    JOIN cf_entities e ON e.entity_id = pe.entity_id
    WHERE pe.person_id = p_person_id
    GROUP BY pe.person_id
  ),
  person_transactions_summary AS (
    SELECT
      pe.person_id,
      COUNT(t.public_transaction_id) AS transaction_count,
      MIN(t.transaction_date) AS first_activity,
      MAX(t.transaction_date) AS last_activity
    FROM rs_person_cf_entities pe
    LEFT JOIN cf_transactions t ON t.entity_id = pe.entity_id
    WHERE pe.person_id = p_person_id
    GROUP BY pe.person_id
  )
  SELECT 
    COALESCE(ped.total_raised_agg, 0) AS total_raised,
    COALESCE(ped.total_spent_agg, 0) AS total_spent,
    COALESCE(ped.entity_count_agg, 0) AS entity_count,
    COALESCE(pts.transaction_count, 0) AS transaction_count,
    pts.first_activity,
    pts.last_activity,
    COALESCE(ped.entity_details_agg, '[]'::jsonb) AS entity_details
  FROM rs_people p
  LEFT JOIN person_entity_details ped ON p.person_id = ped.person_id
  LEFT JOIN person_transactions_summary pts ON p.person_id = pts.person_id
  WHERE p.person_id = p_person_id;
$;
-- ============================================
-- 8. PERSON TRANSACTIONS (Across all entities)
-- ============================================

CREATE OR REPLACE FUNCTION rs_person_transactions(
  p_person_id bigint,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  transaction_date date,
  amount numeric,
  transaction_type text,
  disposition_id int,
  name text,
  occupation text,
  city text,
  state text,
  entity_id int,
  entity_name text
) LANGUAGE sql STABLE AS $$
  SELECT 
    t.transaction_date,
    t.amount,
    t.transaction_type,
    t.transaction_type_disposition_id,
    COALESCE(NULLIF(t.received_from_or_paid_to, ''), 
             NULLIF(TRIM(CONCAT_WS(', ', t.transaction_last_name, t.transaction_first_name)), '')) AS name,
    t.transaction_occupation AS occupation,
    t.transaction_city AS city,
    t.transaction_state AS state,
    e.entity_id,
    COALESCE(e.primary_candidate_name, e.primary_committee_name) AS entity_name
  FROM rs_person_cf_entities pe
  JOIN cf_entities e ON e.entity_id = pe.entity_id
  JOIN cf_transactions t ON t.entity_id = pe.entity_id
  WHERE pe.person_id = p_person_id
  ORDER BY t.transaction_date DESC, t.public_transaction_id DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================
-- 9. PERSON REPORTS (Across all entities)
-- ============================================

CREATE OR REPLACE FUNCTION rs_person_reports(p_person_id bigint)
RETURNS TABLE (
  report_id int,
  report_name text,
  filing_date date,
  period text,
  donations_total numeric,
  donation_items int,
  pdf_url text,
  entity_id int,
  entity_name text
) LANGUAGE sql STABLE AS $$
  SELECT 
    r.report_id,
    r.rpt_name AS report_name,
    r.rpt_file_date AS filing_date,
    r.rpt_period AS period,
    r.total_donations AS donations_total,
    r.donation_count AS donation_items,
    p.pdf_url,
    e.entity_id,
    COALESCE(e.primary_candidate_name, e.primary_committee_name) AS entity_name
  FROM rs_person_cf_entities pe
  JOIN cf_entities e ON e.entity_id = pe.entity_id
  JOIN cf_reports r ON r.entity_id = pe.entity_id
  LEFT JOIN cf_report_pdfs p ON p.pdf_id = r.pdf_id
  WHERE pe.person_id = p_person_id
  ORDER BY r.rpt_file_date DESC NULLS LAST, r.report_id DESC;
$$;

-- ============================================
-- 10. SEARCH - PEOPLE FIRST
-- ============================================

CREATE OR REPLACE FUNCTION rs_search_people(
  q text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  person_id bigint,
  display_name text,
  description text,
  person_type text
) LANGUAGE sql STABLE AS $$
  SELECT 
    person_id,
    display_name,
    CASE 
      WHEN array_length(positions_held, 1) > 0 THEN 
        positions_held[1] || CASE WHEN array_length(positions_held, 1) > 1 
          THEN ' +' || (array_length(positions_held, 1) - 1)::text || ' more' 
          ELSE '' END
      WHEN entity_count > 0 THEN 
        'Campaign Finance: $' || TO_CHAR(total_raised, 'FM999,999,999')
      ELSE 'No legislative or finance data'
    END AS description,
    person_type
  FROM rs_mv_people_legislator_index
  WHERE q <> '' AND display_name ILIKE '%' || q || '%'
  ORDER BY 
    CASE WHEN person_type = 'legislator' THEN 1 
         WHEN person_type = 'candidate' THEN 2 
         ELSE 3 END,
    display_name
  LIMIT p_limit;
$$;

-- ============================================
-- REFRESH FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION rs_refresh_people_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY rs_mv_people_legislator_index;
END $$;