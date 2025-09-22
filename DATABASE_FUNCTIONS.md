# Database Functions Documentation

This document contains the complete SQL implementations for the working database functions used in the campaign finance analysis system.

## 1. get_session_bills(p_person_id BIGINT, p_start_date DATE, p_end_date DATE)

**Purpose:** Get voting records with outlier detection and sponsorship information for a person within a date range.

**Returns:** bill_id, bill_number, bill_title, vote_value, vote_date, is_sponsor, session_id, is_outlier, party_breakdown

**Implementation:**
```sql
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
```

## 2. get_legislator_donations(p_person_id BIGINT, p_start_date DATE, p_end_date DATE)

**Purpose:** Get campaign donations from cf_transactions table with intelligent name parsing and entity type filtering.

**Returns:** transaction_id, donor_name, donation_date, amount, entity_type_id

**Implementation:**
```sql
SELECT DISTINCT
  t.transaction_id,
  -- Use pre-parsed name columns
  CASE
    WHEN t.transaction_entity_type_id = 1 THEN
      -- For individuals, combine last name, first name
      COALESCE(t.transaction_last_name, '') ||
      CASE
        WHEN t.transaction_first_name IS NOT NULL
        THEN ', ' || t.transaction_first_name
        ELSE ''
      END
    ELSE
      -- For organizations, use the last name field which contains the org name
      COALESCE(t.transaction_last_name, t.received_from_or_paid_to)
  END AS donor_name,
  t.transaction_date AS donation_date,
  t.amount,
  t.transaction_entity_type_id AS entity_type_id  -- This is the DONOR's type!
FROM cf_transactions t
WHERE t.entity_id IN (
  -- Get all campaign finance entities for this person
  SELECT DISTINCT pce.entity_id
  FROM rs_person_cf_entities pce
  WHERE pce.person_id = p_person_id
)
-- Filter for contributions received only (disposition 1, not 2 which is expenditures)
AND t.transaction_type_disposition_id = 1
-- Date range filter (100 days before and after session)
AND t.transaction_date BETWEEN p_start_date AND p_end_date
-- Minimum amount filter
AND t.amount >= 100
-- Include EITHER political entity types OR individuals with relevant occupations
AND (
  -- Political entity types for DONORS (using transaction_entity_type_id)
  t.transaction_entity_type_id IN (
    3,   -- Business
    15,  -- Support/Oppose (Candidate)
    16,  -- Independent Exp. (Standing) (Multicandidate PAC)
    19,  -- Segregated Fund
    20,  -- Segregated Fund (Multicandidate PAC)
    21,  -- Segregated Fund (Standing)
    22,  -- Segregated Fund (Standing) (Multicandidate PAC)
    23,  -- Independent Expenditures
    24,  -- Independent Expenditures (Multicandidate PAC)
    27,  -- Political Organization
    35,  -- Non-Arizona Committee
    37,  -- Independent Expenditures (Corp/LLC/Labor Org)
    39,  -- Political Action Committee
    40,  -- Political Action Committee (Standing)
    41,  -- Political Action Committee (Mega)
    42,  -- Political Action Committee (Mega Standing)
    43,  -- Partnership
    44,  -- Business Vendor
    45,  -- Corps/LLCs as Contributors
    46,  -- Labor Orgs as Contributors
    47,  -- Non-Arizona Candidate Committee
    48   -- Non-Arizona PAC
  )
  OR
  -- Individual donors with political/influential occupations
  (
    t.transaction_entity_type_id = 1 AND (
      UPPER(t.transaction_occupation) ILIKE '%LOBBYIST%'
      OR UPPER(t.transaction_occupation) ILIKE '%LOBBY%'
      OR UPPER(t.transaction_occupation) ILIKE '%GOVERNMENT%RELATIONS%'
      OR UPPER(t.transaction_occupation) ILIKE '%CONSULTANT%'
      OR UPPER(t.transaction_occupation) ILIKE '%CEO%'
      OR UPPER(t.transaction_occupation) ILIKE '%PRESIDENT%'
      OR UPPER(t.transaction_occupation) ILIKE '%EXECUTIVE%'
      OR UPPER(t.transaction_occupation) ILIKE '%DIRECTOR%'
      OR UPPER(t.transaction_occupation) ILIKE '%OWNER%'
      OR UPPER(t.transaction_occupation) ILIKE '%PARTNER%'
      OR UPPER(t.transaction_occupation) ILIKE '%ATTORNEY%'
      OR UPPER(t.transaction_occupation) ILIKE '%LAWYER%'
      OR UPPER(t.transaction_occupation) ILIKE '%DEVELOPER%'
      OR UPPER(t.transaction_occupation) ILIKE '%CONTRACTOR%'
      OR UPPER(t.transaction_occupation) ILIKE '%PRINCIPAL%'
      OR UPPER(t.transaction_occupation) ILIKE '%FOUNDER%'
      OR UPPER(t.transaction_occupation) ILIKE '%CHAIRMAN%'
      OR UPPER(t.transaction_occupation) ILIKE '%MANAGER%'
    )
  )
)
ORDER BY t.amount DESC, t.transaction_date DESC
LIMIT 5000;  -- Limit to prevent timeout
```

## 3. get_person_sessions(p_person_id BIGINT)

**Purpose:** Get legislative sessions for a person with vote counts and date information.

**Returns:** session_id, session_name, year, start_date, end_date, vote_count, date_range_display

**Implementation:**
```sql
SELECT DISTINCT
  s.session_id::INT,
  s.session_name,
  s.year::INT,
  COALESCE(s.first_vote_date, s.official_start_date) AS start_date,
  COALESCE(s.last_vote_date, s.official_end_date) AS end_date,
  COALESCE(bill_counts.bill_count, 0)::BIGINT as vote_count,
  s.date_range_display
FROM rs_person_leg_sessions pls
INNER JOIN mv_sessions_with_dates s ON pls.session_id = s.session_id
LEFT JOIN LATERAL (
  -- Count unique bills voted on by ANY of this person's legislator IDs in this session
  SELECT COUNT(DISTINCT v.bill_id) as bill_count
  FROM votes v
  INNER JOIN bills b ON v.bill_id = b.bill_id
  WHERE b.session_id = s.session_id
    AND v.legislator_id IN (
      -- Get all legislator IDs for this person
      SELECT DISTINCT pl.legislator_id
      FROM rs_person_legislators pl
      WHERE pl.person_id = p_person_id
    )
) bill_counts ON true
WHERE pls.person_id = p_person_id
ORDER BY s.year DESC, s.session_id DESC;
```

## 4. rs_search_people(p_q, p_limit) - Search Function

**Purpose:** Search for people with legislator and entity counts. **Should only return actual legislators (leg_cnt > 0).**

**Parameters:**
- p_q: search query string
- p_limit: maximum results to return

**Returns:** person_id, label (display_name), extra (counts info)

**Current Implementation (needs fixing):**
```sql
SELECT
  p.person_id,
  p.display_name as label,
  CONCAT(
    COALESCE(lc.leg_cnt,0), ' legis IDs • ',
    COALESCE(ec.ent_cnt,0), ' entities'
  ) as extra
FROM rs_people p
LEFT JOIN (
  SELECT person_id, COUNT(*) as leg_cnt
  FROM rs_person_legislators GROUP BY person_id
) lc USING (person_id)
LEFT JOIN (
  SELECT person_id, COUNT(*) as ent_cnt
  FROM rs_person_cf_entities GROUP BY person_id
) ec USING (person_id)
WHERE p.display_name ILIKE '%' || p_q || '%'
AND lc.leg_cnt > 0  -- Add this line to only show actual legislators
ORDER BY p.display_name
LIMIT p_limit;
```

**Note:** The current database function returns all people including campaign finance-only entities. The frontend currently filters for `leg_cnt > 0` to show only legislators.

## 5. get_bill_details (for Phase 2 analysis)

**Purpose:** Get full bill details including text and summary for AI analysis.

**Returns:** bill_id, session_id, bill_number, short_title, description, bill_text, bill_summary, primary_sponsor_name, date_introduced, final_disposition, governor_action

**Implementation:**
```sql
SELECT
  b.bill_id,
  b.session_id,
  b.bill_number,
  b.short_title,
  b.description,
  b.bill_text,
  b.bill_summary,
  b.primary_sponsor_name,
  b.date_introduced,
  b.final_disposition,
  b.governor_action
FROM bills b
WHERE b.bill_id = p_bill_id;
```

## 6. search_rts_positions (Request to Speak)

**Purpose:** Get Request to Speak positions on bills for additional context.

**Returns:** bill_id, entity_name, representing, rts_position, submitted_date

**Implementation:**
```sql
SELECT
  r.bill_id,
  r.entity_name,
  r.representing,
  r.position AS rts_position,   -- alias to avoid reserved word issues
  r.submitted_date
FROM public.rts_positions r
WHERE (p_bill_ids IS NULL OR r.bill_id = ANY (p_bill_ids))
  AND (
       p_keywords IS NULL
       OR cardinality(p_keywords) = 0
       OR EXISTS (
            SELECT 1
            FROM unnest(p_keywords) kw
            WHERE r.entity_name   ILIKE ('%' || kw || '%')
               OR r.representing  ILIKE ('%' || kw || '%')
       )
  )
ORDER BY r.submitted_date DESC NULLS LAST
LIMIT p_limit;
```

## Key Notes

1. **All functions use date ranges** instead of session_ids arrays for consistency
2. **get_session_bills** includes outlier detection when legislators vote against their party majority
3. **get_legislator_donations** uses cf_transactions table with sophisticated entity type and occupation filtering
4. **Donor name parsing** handles both individuals (Last, First format) and organizations
5. **Entity type filtering** includes both PACs/businesses and individuals with politically relevant occupations
6. **All functions handle person_id** as the primary identifier, which maps to multiple legislator_ids and entity_ids

## Database Setup

These functions expect the following key tables and relationships:
- `rs_person_legislators` - Maps people to legislator IDs
- `rs_person_cf_entities` - Maps people to campaign finance entities
- `cf_transactions` - Campaign finance transactions (not cf_donations)
- `bills`, `votes`, `bill_sponsors` - Legislative data
- `mv_sessions_with_dates` - Materialized view with session date ranges