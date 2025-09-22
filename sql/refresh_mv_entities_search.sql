-- Refresh the materialized view to update with current data
REFRESH MATERIALIZED VIEW mv_entities_search;

-- If you want to refresh it concurrently (doesn't lock the view during refresh):
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_entities_search;
-- Note: CONCURRENTLY requires the view to have a unique index

-- Check if the refresh worked for person 126
SELECT
    person_id,
    display_name,
    all_entity_ids,
    all_legislator_ids
FROM mv_entities_search
WHERE person_id = 126;