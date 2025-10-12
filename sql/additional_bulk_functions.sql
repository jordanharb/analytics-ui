-- Additional RPC Functions for Bulk Operations
-- Optimizes event deduplication, twitter scraper, and flash event processor

-- ============================================================================
-- DROP EXISTING FUNCTIONS (to ensure clean updates)
-- ============================================================================

DROP FUNCTION IF EXISTS merge_event_post_links(UUID, UUID);
DROP FUNCTION IF EXISTS merge_event_actor_links(UUID, UUID);
DROP FUNCTION IF EXISTS merge_duplicate_event(UUID, UUID);
DROP FUNCTION IF EXISTS bulk_update_last_scrape(UUID[], TIMESTAMPTZ);
DROP FUNCTION IF EXISTS bulk_update_last_scrape_by_username(TEXT[], TIMESTAMPTZ);
DROP FUNCTION IF EXISTS bulk_upsert_event_actor_links(JSONB);
DROP FUNCTION IF EXISTS check_missing_post_actor_links(JSONB);
DROP FUNCTION IF EXISTS bulk_insert_post_actor_links(JSONB);

-- ============================================================================
-- EVENT DEDUPLICATOR FUNCTIONS
-- ============================================================================

-- Merge post links from duplicate event to primary event
-- Moves all unique post links in a single query, handling duplicates
CREATE FUNCTION merge_event_post_links(
    p_primary_id UUID,
    p_duplicate_id UUID
)
RETURNS TABLE(
    moved_count INT,
    duplicate_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_moved_count INT := 0;
    v_duplicate_count INT := 0;
BEGIN
    -- Update links to point to primary, but only for posts not already linked
    WITH duplicate_links AS (
        SELECT post_id
        FROM v2_event_post_links
        WHERE event_id = p_duplicate_id
    ),
    primary_posts AS (
        SELECT post_id
        FROM v2_event_post_links
        WHERE event_id = p_primary_id
    ),
    to_move AS (
        SELECT dl.post_id
        FROM duplicate_links dl
        WHERE dl.post_id NOT IN (SELECT post_id FROM primary_posts)
    )
    UPDATE v2_event_post_links
    SET event_id = p_primary_id
    WHERE event_id = p_duplicate_id
      AND post_id IN (SELECT post_id FROM to_move);

    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    -- Delete remaining duplicate links (those that already existed on primary)
    DELETE FROM v2_event_post_links
    WHERE event_id = p_duplicate_id;

    GET DIAGNOSTICS v_duplicate_count = ROW_COUNT;

    RETURN QUERY SELECT v_moved_count, v_duplicate_count;
END;
$$;

-- Merge actor links from duplicate event to primary event
-- Creates new links for actors not already linked to primary
CREATE FUNCTION merge_event_actor_links(
    p_primary_id UUID,
    p_duplicate_id UUID
)
RETURNS TABLE(
    moved_count INT,
    duplicate_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_moved_count INT := 0;
    v_duplicate_count INT := 0;
BEGIN
    -- Insert unique actor links from duplicate to primary
    WITH duplicate_links AS (
        SELECT
            actor_handle,
            platform,
            actor_type,
            actor_id,
            unknown_actor_id
        FROM v2_event_actor_links
        WHERE event_id = p_duplicate_id
    ),
    primary_links AS (
        SELECT actor_handle, platform
        FROM v2_event_actor_links
        WHERE event_id = p_primary_id
    ),
    to_insert AS (
        SELECT
            p_primary_id as event_id,
            dl.actor_handle,
            dl.platform,
            dl.actor_type,
            dl.actor_id,
            dl.unknown_actor_id
        FROM duplicate_links dl
        WHERE NOT EXISTS (
            SELECT 1
            FROM primary_links pl
            WHERE pl.actor_handle = dl.actor_handle
              AND pl.platform = dl.platform
        )
    )
    INSERT INTO v2_event_actor_links (
        event_id, actor_handle, platform, actor_type, actor_id, unknown_actor_id
    )
    SELECT event_id, actor_handle, platform, actor_type, actor_id, unknown_actor_id
    FROM to_insert
    ON CONFLICT (event_id, actor_handle, platform) DO NOTHING;

    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    -- Count how many were duplicates
    SELECT COUNT(*)
    INTO v_duplicate_count
    FROM v2_event_actor_links
    WHERE event_id = p_duplicate_id;

    -- Delete old actor links from duplicate
    DELETE FROM v2_event_actor_links
    WHERE event_id = p_duplicate_id;

    RETURN QUERY SELECT v_moved_count, v_duplicate_count;
END;
$$;

-- Complete event merge operation (post links + actor links + event deletion)
-- Combines all merge operations into a single transaction
CREATE FUNCTION merge_duplicate_event(
    p_primary_id UUID,
    p_duplicate_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_post_moved INT;
    v_post_dups INT;
    v_actor_moved INT;
    v_actor_dups INT;
    v_result JSONB;
BEGIN
    -- Merge post links
    SELECT moved_count, duplicate_count
    INTO v_post_moved, v_post_dups
    FROM merge_event_post_links(p_primary_id, p_duplicate_id);

    -- Merge actor links
    SELECT moved_count, duplicate_count
    INTO v_actor_moved, v_actor_dups
    FROM merge_event_actor_links(p_primary_id, p_duplicate_id);

    -- Delete the duplicate event
    DELETE FROM v2_events WHERE id = p_duplicate_id;

    -- Return summary
    v_result := jsonb_build_object(
        'posts_moved', v_post_moved,
        'posts_duplicates', v_post_dups,
        'actors_moved', v_actor_moved,
        'actors_duplicates', v_actor_dups,
        'success', true
    );

    RETURN v_result;
END;
$$;

-- ============================================================================
-- TWITTER SCRAPER FUNCTIONS
-- ============================================================================

-- Bulk update last_scrape timestamps for multiple actor usernames
-- Updates all in a single query instead of N individual queries
CREATE FUNCTION bulk_update_last_scrape(
    actor_ids UUID[],
    scrape_timestamp TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    update_count INT;
BEGIN
    UPDATE v2_actor_usernames
    SET last_scrape = scrape_timestamp
    WHERE actor_id = ANY(actor_ids)
      AND platform = 'twitter';

    GET DIAGNOSTICS update_count = ROW_COUNT;
    RETURN update_count;
END;
$$;

-- Alternative: Update by username (if actor_id not available)
CREATE FUNCTION bulk_update_last_scrape_by_username(
    usernames TEXT[],
    scrape_timestamp TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    update_count INT;
BEGIN
    UPDATE v2_actor_usernames
    SET last_scrape = scrape_timestamp
    WHERE username = ANY(usernames)
      AND platform = 'twitter';

    GET DIAGNOSTICS update_count = ROW_COUNT;
    RETURN update_count;
END;
$$;

-- ============================================================================
-- FLASH EVENT PROCESSOR FUNCTIONS
-- ============================================================================

-- Bulk upsert event-actor links
-- Creates all links in one query with ON CONFLICT handling
CREATE FUNCTION bulk_upsert_event_actor_links(links JSONB)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    insert_count INT;
BEGIN
    WITH data AS (
        SELECT
            (value->>'event_id')::UUID as event_id,
            value->>'actor_handle' as actor_handle,
            value->>'platform' as platform,
            value->>'actor_type' as actor_type,
            (value->>'actor_id')::UUID as actor_id,
            (value->>'unknown_actor_id')::UUID as unknown_actor_id
        FROM jsonb_array_elements(links)
    )
    INSERT INTO v2_event_actor_links (
        event_id, actor_handle, platform, actor_type, actor_id, unknown_actor_id
    )
    SELECT
        event_id, actor_handle, platform, actor_type, actor_id, unknown_actor_id
    FROM data
    ON CONFLICT (event_id, actor_handle, platform)
    DO UPDATE SET
        actor_type = EXCLUDED.actor_type,
        actor_id = EXCLUDED.actor_id,
        unknown_actor_id = EXCLUDED.unknown_actor_id,
        updated_at = NOW();

    GET DIAGNOSTICS insert_count = ROW_COUNT;
    RETURN insert_count;
END;
$$;

-- Bulk check which post-actor links already exist
-- Returns only the post_id + actor_id combinations that DON'T exist yet
CREATE FUNCTION check_missing_post_actor_links(
    post_actor_pairs JSONB
)
RETURNS TABLE(
    post_id UUID,
    actor_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH input_pairs AS (
        SELECT
            (value->>'post_id')::UUID as post_id,
            (value->>'actor_id')::UUID as actor_id
        FROM jsonb_array_elements(post_actor_pairs)
    )
    SELECT ip.post_id, ip.actor_id
    FROM input_pairs ip
    WHERE NOT EXISTS (
        SELECT 1
        FROM v2_post_actors pa
        WHERE pa.post_id = ip.post_id
          AND pa.actor_id = ip.actor_id
    );
END;
$$;

-- Bulk insert post-actor links with ON CONFLICT
CREATE FUNCTION bulk_insert_post_actor_links(links JSONB)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    insert_count INT;
BEGIN
    WITH data AS (
        SELECT
            (value->>'post_id')::UUID as post_id,
            (value->>'actor_id')::UUID as actor_id,
            value->>'actor_type' as actor_type,
            value->>'relationship_type' as relationship_type
        FROM jsonb_array_elements(links)
    )
    INSERT INTO v2_post_actors (
        post_id, actor_id, actor_type, relationship_type
    )
    SELECT
        post_id, actor_id, actor_type, relationship_type
    FROM data
    ON CONFLICT (post_id, actor_id) DO NOTHING;

    GET DIAGNOSTICS insert_count = ROW_COUNT;
    RETURN insert_count;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION merge_event_post_links(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION merge_event_actor_links(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION merge_duplicate_event(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_update_last_scrape(UUID[], TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_update_last_scrape_by_username(TEXT[], TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_upsert_event_actor_links(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION check_missing_post_actor_links(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_insert_post_actor_links(JSONB) TO authenticated;

-- Grant to service_role for automation scripts
GRANT EXECUTE ON FUNCTION merge_event_post_links(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION merge_event_actor_links(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION merge_duplicate_event(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_update_last_scrape(UUID[], TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_update_last_scrape_by_username(TEXT[], TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_upsert_event_actor_links(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION check_missing_post_actor_links(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_insert_post_actor_links(JSONB) TO service_role;

-- ============================================================================
-- DOCUMENTATION COMMENTS
-- ============================================================================

COMMENT ON FUNCTION merge_event_post_links(UUID, UUID) IS
'Merges post links from duplicate event to primary event in a single query. Returns counts of moved and duplicate links.';

COMMENT ON FUNCTION merge_event_actor_links(UUID, UUID) IS
'Merges actor links from duplicate event to primary event in a single query. Returns counts of moved and duplicate links.';

COMMENT ON FUNCTION merge_duplicate_event(UUID, UUID) IS
'Complete event merge operation: moves post links, actor links, and deletes duplicate event. Returns JSONB summary.';

COMMENT ON FUNCTION bulk_update_last_scrape(UUID[], TIMESTAMPTZ) IS
'Updates last_scrape timestamp for multiple Twitter actor_ids in a single query. Returns count of updated rows.';

COMMENT ON FUNCTION bulk_update_last_scrape_by_username(TEXT[], TIMESTAMPTZ) IS
'Updates last_scrape timestamp for multiple Twitter usernames in a single query. Returns count of updated rows.';

COMMENT ON FUNCTION bulk_upsert_event_actor_links(JSONB) IS
'Bulk upserts event-actor links with ON CONFLICT handling. Expects JSONB array of link objects.';

COMMENT ON FUNCTION check_missing_post_actor_links(JSONB) IS
'Returns which post-actor pairs do NOT already exist in v2_post_actors. Used for efficient duplicate checking.';

COMMENT ON FUNCTION bulk_insert_post_actor_links(JSONB) IS
'Bulk inserts post-actor links with ON CONFLICT DO NOTHING. Expects JSONB array of link objects.';
