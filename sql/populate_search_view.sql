-- Create and populate the materialized view for search_entities function
-- This view is required for the search functionality to work

-- Drop the materialized view if it exists
DROP MATERIALIZED VIEW IF EXISTS mv_entities_search CASCADE;

-- Create the materialized view
CREATE MATERIALIZED VIEW mv_entities_search AS
SELECT
    e.entity_id,
    COALESCE(
        e.primary_candidate_name,
        e.primary_committee_name,
        CAST(e.entity_id AS VARCHAR)
    ) AS name,
    r.party_name,
    r.office_name,
    e.latest_activity,
    e.total_income_all_records AS total_income,
    e.total_expense_all_records AS total_expense
FROM cf_entities e
LEFT JOIN cf_entity_records r ON e.entity_id = r.entity_id AND r.is_primary_record = true
WHERE e.primary_candidate_name IS NOT NULL
   OR e.primary_committee_name IS NOT NULL;

-- Create an index on the name column for faster searching
CREATE INDEX idx_mv_entities_search_name ON mv_entities_search USING gin (name gin_trgm_ops);
CREATE INDEX idx_mv_entities_search_entity_id ON mv_entities_search (entity_id);

-- Grant permissions
GRANT SELECT ON mv_entities_search TO anon;
GRANT SELECT ON mv_entities_search TO authenticated;
GRANT SELECT ON mv_entities_search TO service_role;

-- Refresh the materialized view with current data
REFRESH MATERIALIZED VIEW mv_entities_search;

-- Verify the data was populated
SELECT COUNT(*) as total_records FROM mv_entities_search;
SELECT * FROM mv_entities_search LIMIT 5;