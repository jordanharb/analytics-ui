-- Optimized version to populate primary_sponsor_name in bills table
-- This version processes in smaller batches to avoid timeouts

-- First, create an index if it doesn't exist to speed up the joins
CREATE INDEX IF NOT EXISTS idx_bill_sponsors_bill_id ON bill_sponsors(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_sponsors_sponsor_type ON bill_sponsors(sponsor_type);

-- Update only bills that don't have a sponsor name yet (in batches)
-- Batch 1: Update bills with primary sponsors (sponsor_type = 'P')
UPDATE bills b
SET primary_sponsor_name = (
    SELECT l.full_name
    FROM bill_sponsors bs
    JOIN legislators l ON bs.legislator_id = l.legislator_id
    WHERE bs.bill_id = b.bill_id
    AND bs.sponsor_type = 'P'
    LIMIT 1
)
WHERE b.primary_sponsor_name IS NULL
AND EXISTS (
    SELECT 1 FROM bill_sponsors bs2
    WHERE bs2.bill_id = b.bill_id
    AND bs2.sponsor_type = 'P'
);

-- Check how many were updated
SELECT 
    COUNT(*) as bills_updated_with_primary_sponsor
FROM bills 
WHERE primary_sponsor_name IS NOT NULL;

-- Batch 2: Update remaining bills with the first sponsor (no 'P' type)
-- Use a subquery with LIMIT to process in batches
UPDATE bills b
SET primary_sponsor_name = (
    SELECT l.full_name
    FROM bill_sponsors bs
    JOIN legislators l ON bs.legislator_id = l.legislator_id
    WHERE bs.bill_id = b.bill_id
    ORDER BY bs.display_order, bs.id
    LIMIT 1
)
WHERE b.bill_id IN (
    SELECT bill_id
    FROM bills
    WHERE primary_sponsor_name IS NULL
    AND EXISTS (
        SELECT 1 FROM bill_sponsors bs2
        WHERE bs2.bill_id = bills.bill_id
    )
    LIMIT 500
);

-- Final check
SELECT 
    COUNT(*) as total_bills,
    COUNT(primary_sponsor_name) as bills_with_sponsor,
    COUNT(*) - COUNT(primary_sponsor_name) as bills_without_sponsor
FROM bills;

-- Show a sample
SELECT 
    bill_id,
    bill_number,
    short_title,
    primary_sponsor_name
FROM bills
WHERE primary_sponsor_name IS NOT NULL
LIMIT 10;
