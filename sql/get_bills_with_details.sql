-- RPC function to get bills with sponsors and last action date
DROP FUNCTION IF EXISTS get_bills_with_details(INT, TEXT, INT, INT);
CREATE OR REPLACE FUNCTION get_bills_with_details(
    p_session_id INT,
    p_search_term TEXT DEFAULT NULL,
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
    primary_sponsor_name VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.bill_id,
        b.session_id,
        b.bill_number,
        b.short_title,
        b.description,
        b.date_introduced,
        b.final_disposition,
        b.governor_action,
        -- Get the most recent vote/action date
        (SELECT MAX(v.vote_date) 
         FROM votes v 
         WHERE v.bill_id = b.bill_id) as last_action_date,
        -- Get all sponsors as JSON
        (SELECT json_agg(
            json_build_object(
                'legislator_id', bs.legislator_id,
                'full_name', l.full_name,
                'party', l.party,
                'sponsor_type', bs.sponsor_type,
                'display_order', bs.display_order
            ) ORDER BY 
                CASE WHEN bs.sponsor_type = 'P' THEN 0 ELSE 1 END,
                bs.display_order,
                bs.id
        )
        FROM bill_sponsors bs
        JOIN legislators l ON bs.legislator_id = l.legislator_id
        WHERE bs.bill_id = b.bill_id
        ) as sponsors,
        -- Get primary sponsor name for backward compatibility
        (SELECT l.full_name
         FROM bill_sponsors bs
         JOIN legislators l ON bs.legislator_id = l.legislator_id
         WHERE bs.bill_id = b.bill_id
         ORDER BY 
            CASE WHEN bs.sponsor_type = 'P' THEN 0 ELSE 1 END,
            bs.display_order,
            bs.id
         LIMIT 1
        ) as primary_sponsor_name
    FROM bills b
    WHERE b.session_id = p_session_id
    AND (
        p_search_term IS NULL 
        OR b.bill_number ILIKE '%' || p_search_term || '%'
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
    ORDER BY b.date_introduced DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- Test the function
SELECT * FROM get_bills_with_details(56, NULL, 5, 0);
