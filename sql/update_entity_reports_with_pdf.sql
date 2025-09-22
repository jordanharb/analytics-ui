-- Update the get_entity_reports function to include pdf_url from cf_report_pdfs table

DROP FUNCTION IF EXISTS get_entity_reports(INT);
CREATE OR REPLACE FUNCTION get_entity_reports(p_entity_id INT)
RETURNS TABLE (
    report_id INTEGER,
    rpt_title VARCHAR,
    rpt_name VARCHAR,
    rpt_cycle INTEGER,
    rpt_file_date DATE,
    rpt_period VARCHAR,
    total_donations NUMERIC,
    total_expenditures NUMERIC,
    total_income NUMERIC,
    donation_count INTEGER,
    cash_balance_beginning NUMERIC,
    cash_balance_ending NUMERIC,
    report_type VARCHAR,
    is_amended BOOLEAN,
    pdf_url TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.report_id,
        r.rpt_title,
        r.rpt_name,
        r.rpt_cycle,
        r.rpt_file_date,
        r.rpt_period,
        r.total_donations,
        r.total_expenditures,
        r.total_income,
        r.donation_count,
        r.cash_balance_beginning,
        r.cash_balance_ending,
        r.report_type,
        r.is_amended,
        p.pdf_url::TEXT
    FROM cf_reports r
    LEFT JOIN cf_report_pdfs p ON r.pdf_id = p.pdf_id
    WHERE r.entity_id = p_entity_id
    ORDER BY r.rpt_file_date DESC;
END;
$$;

-- Test the function
SELECT * FROM get_entity_reports(201800416) LIMIT 5;
