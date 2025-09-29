-- This script cleans up all previous versions and creates the definitive hybrid search function.

-- 1. Drop all possible conflicting function signatures for a clean slate.
DROP FUNCTION IF EXISTS get_bills_with_details(INT, TEXT, vector(1536), INT, INT, INT);
DROP FUNCTION IF EXISTS get_bills_with_details(INT, TEXT, vector(1536), INT, INT);
DROP FUNCTION IF EXISTS get_bills_with_details(INT, TEXT, INT, INT);

-- 2. Create the one function you need: original + vector search.
CREATE OR REPLACE FUNCTION get_bills_with_details(
    p_session_id INT,
    p_search_term TEXT DEFAULT NULL,
    p_query_vec vector(1536) DEFAULT NULL,
    p_limit INT DEFAULT 100,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    bill_id INTEGER,
    session_id INTEGER,
    bill_number VARCHAR,
    short_title TEXT,
    description TEXT,
    date_introduced DATE,
    final_disposition VARCHAR,
    governor_action VARCHAR,
    last_action_date DATE,
    sponsors JSON,
    primary_sponsor_name VARCHAR,
    match_score REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH search_results AS (
        SELECT
            b.bill_id,
            -- Calculate a score based on keyword and vector similarity
            (
                (CASE WHEN p_search_term IS NOT NULL AND (
                    b.bill_number ILIKE '%' || p_search_term || '%' OR
                    b.short_title ILIKE '%' || p_search_term || '%' OR
                    b.description ILIKE '%' || p_search_term || '%' OR
                    EXISTS (
                        SELECT 1
                        FROM bill_sponsors bs2
                        JOIN legislators l2 ON bs2.legislator_id = l2.legislator_id
                        WHERE bs2.bill_id = b.bill_id
                        AND l2.full_name ILIKE '%' || p_search_term || '%'
                    )
                ) THEN 0.4 ELSE 0 END) -- Keyword match bonus
                +
                (CASE WHEN p_query_vec IS NOT NULL THEN
                    GREATEST(
                        COALESCE(1 - (b.embedding_summary <=> p_query_vec), 0),
                        COALESCE(1 - (b.embedding_full <=> p_query_vec), 0)
                    )
                ELSE 0 END) * 0.6 -- Vector similarity
            ) AS calculated_score
        FROM bills b
        WHERE b.session_id = p_session_id
        AND (
            -- Return all if no search term
            p_search_term IS NULL OR
            -- Keyword match
            (
                b.bill_number ILIKE '%' || p_search_term || '%'
                OR b.short_title ILIKE '%' || p_search_term || '%'
                OR b.description ILIKE '%' || p_search_term || '%'
                OR EXISTS (
                    SELECT 1
                    FROM bill_sponsors bs2
                    JOIN legislators l2 ON bs2.legislator_id = l2.legislator_id
                    WHERE bs2.bill_id = b.bill_id
                    AND l2.full_name ILIKE '%' || p_search_term || '%'
                )
            )
            OR
            -- Vector match
            (
                p_query_vec IS NOT NULL AND (
                    (1 - (b.embedding_summary <=> p_query_vec)) > 0.3 OR
                    (1 - (b.embedding_full <=> p_query_vec)) > 0.3
                )
            )
        )
    )
    SELECT
        b.bill_id,
        b.session_id,
        b.bill_number,
        b.short_title,
        b.description,
        b.date_introduced,
        b.final_disposition,
        b.governor_action,
        (SELECT MAX(v.vote_date) FROM votes v WHERE v.bill_id = b.bill_id) as last_action_date,
        (SELECT json_agg(
            json_build_object(
                'legislator_id', bs.legislator_id, 'full_name', l.full_name, 'party', l.party,
                'sponsor_type', bs.sponsor_type, 'display_order', bs.display_order
            ) ORDER BY CASE WHEN bs.sponsor_type = 'P' THEN 0 ELSE 1 END, bs.display_order, bs.id
        ) FROM bill_sponsors bs JOIN legislators l ON bs.legislator_id = l.legislator_id WHERE bs.bill_id = b.bill_id) as sponsors,
        (SELECT l.full_name FROM bill_sponsors bs JOIN legislators l ON bs.legislator_id = l.legislator_id
         WHERE bs.bill_id = b.bill_id ORDER BY CASE WHEN bs.sponsor_type = 'P' THEN 0 ELSE 1 END, bs.display_order, bs.id LIMIT 1) as primary_sponsor_name,
        sr.calculated_score::REAL AS match_score
    FROM bills b
    JOIN search_results sr ON b.bill_id = sr.bill_id
    WHERE (p_search_term IS NULL AND p_query_vec IS NULL) OR sr.calculated_score > 0.1 -- Filter out low-scoring results only when searching
    ORDER BY sr.calculated_score DESC, b.date_introduced DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;