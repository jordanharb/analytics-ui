-- SQL script to populate primary_sponsor_name in bills table
-- This script updates the bills table with the primary sponsor name
-- from the bill_sponsors and legislators tables

-- First, let's check the structure to understand the relationships
-- The primary sponsor is typically the sponsor with sponsor_type = 'P' (Primary)
-- or the first sponsor in the list if no type is specified

-- Update bills with primary sponsor name
UPDATE bills b
SET primary_sponsor_name = COALESCE(
    -- First try to get the primary sponsor (sponsor_type = 'P')
    (
        SELECT l.full_name
        FROM bill_sponsors bs
        JOIN legislators l ON bs.legislator_id = l.legislator_id
        WHERE bs.bill_id = b.bill_id
        AND bs.sponsor_type = 'P'
        LIMIT 1
    ),
    -- If no primary sponsor, get the first sponsor
    (
        SELECT l.full_name
        FROM bill_sponsors bs
        JOIN legislators l ON bs.legislator_id = l.legislator_id
        WHERE bs.bill_id = b.bill_id
        ORDER BY bs.display_order, bs.id
        LIMIT 1
    )
)
WHERE b.primary_sponsor_name IS NULL
   OR b.primary_sponsor_name = '';

-- Verify the update
SELECT 
    COUNT(*) as total_bills,
    COUNT(primary_sponsor_name) as bills_with_sponsor,
    COUNT(*) - COUNT(primary_sponsor_name) as bills_without_sponsor
FROM bills;

-- Show a sample of updated bills
SELECT 
    bill_id,
    bill_number,
    short_title,
    primary_sponsor_name
FROM bills
WHERE primary_sponsor_name IS NOT NULL
LIMIT 10;

-- Show bills that still don't have a sponsor (might not have entries in bill_sponsors)
SELECT 
    b.bill_id,
    b.bill_number,
    b.short_title,
    COUNT(bs.bill_sponsor_id) as sponsor_count
FROM bills b
LEFT JOIN bill_sponsors bs ON b.bill_id = bs.bill_id
WHERE b.primary_sponsor_name IS NULL
GROUP BY b.bill_id, b.bill_number, b.short_title
LIMIT 10;
