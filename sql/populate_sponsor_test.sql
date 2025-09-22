-- Test version - update just a few bills to verify it works

-- First, let's see what we're working with
SELECT 
    b.bill_id,
    b.bill_number,
    b.primary_sponsor_name as current_sponsor,
    l.full_name as should_be_sponsor,
    bs.sponsor_type
FROM bills b
JOIN bill_sponsors bs ON b.bill_id = bs.bill_id
JOIN legislators l ON bs.legislator_id = l.legislator_id
WHERE b.session_id = 56  -- Most recent session
AND (bs.sponsor_type = 'P' OR bs.display_order = 1)
LIMIT 10;

-- Update just 10 bills as a test
UPDATE bills b
SET primary_sponsor_name = (
    SELECT l.full_name
    FROM bill_sponsors bs
    JOIN legislators l ON bs.legislator_id = l.legislator_id
    WHERE bs.bill_id = b.bill_id
    ORDER BY 
        CASE WHEN bs.sponsor_type = 'P' THEN 0 ELSE 1 END,
        bs.display_order,
        bs.id
    LIMIT 1
)
WHERE b.bill_id IN (
    SELECT bill_id 
    FROM bills 
    WHERE session_id = 56 
    AND primary_sponsor_name IS NULL
    LIMIT 10
);

-- Check the results
SELECT 
    bill_id,
    bill_number,
    short_title,
    primary_sponsor_name
FROM bills
WHERE session_id = 56
AND primary_sponsor_name IS NOT NULL
LIMIT 10;
