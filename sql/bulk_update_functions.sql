-- RPC Functions for Bulk Operations
-- These functions optimize data transfer and update performance

-- ============================================================================
-- DROP EXISTING FUNCTIONS (to ensure clean updates)
-- ============================================================================

DROP FUNCTION IF EXISTS get_posts_needing_media(INT);
DROP FUNCTION IF EXISTS bulk_update_post_images(JSONB);
DROP FUNCTION IF EXISTS bulk_insert_posts(JSONB);
DROP FUNCTION IF EXISTS check_existing_post_ids(TEXT[]);

-- ============================================================================
-- MEDIA DOWNLOADER FUNCTIONS
-- ============================================================================

-- Get posts needing media download (minimal data transfer)
-- Excludes posts with EXPIRED status to avoid re-downloading failed URLs
CREATE FUNCTION get_posts_needing_media(batch_limit INT DEFAULT 200)
RETURNS TABLE (
    post_id UUID,
    media_url TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        id,
        (media_urls->0->>'url')::text  -- Extract first media URL from JSONB array
    FROM v2_social_media_posts
    WHERE platform = 'instagram'
      AND media_urls IS NOT NULL
      AND jsonb_array_length(media_urls) > 0
      AND (
          offline_image_url IS NULL
          OR offline_image_url = 'BROKEN'
      )
      -- Explicitly exclude EXPIRED and PERMANENTLY_EXPIRED
      AND (
          offline_image_url IS NULL
          OR offline_image_url NOT IN ('EXPIRED', 'PERMANENTLY_EXPIRED')
      )
    LIMIT batch_limit;
END;
$$;

-- Bulk update offline_image_url (single query for all updates)
CREATE FUNCTION bulk_update_post_images(updates JSONB)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    update_count INT;
BEGIN
    WITH data AS (
        SELECT
            (value->>'id')::UUID as id,
            value->>'offline_image_url' as offline_image_url
        FROM jsonb_array_elements(updates)
    )
    UPDATE v2_social_media_posts p
    SET offline_image_url = d.offline_image_url
    FROM data d
    WHERE p.id = d.id;

    GET DIAGNOSTICS update_count = ROW_COUNT;
    RETURN update_count;
END;
$$;

-- ============================================================================
-- POST PROCESSOR FUNCTIONS
-- ============================================================================

-- Bulk insert posts with ON CONFLICT handling on post_id
-- Returns inserted post IDs and whether they were duplicates
CREATE FUNCTION bulk_insert_posts(posts JSONB)
RETURNS TABLE(
    inserted_id UUID,
    post_id_value TEXT,
    was_inserted BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- First, try to insert all posts
    INSERT INTO v2_social_media_posts (
        post_id,
        platform,
        post_url,
        author_handle,
        author_name,
        content_text,
        post_timestamp,
        media_urls,
        media_count,
        like_count,
        reply_count,
        share_count,
        mentioned_users,
        hashtags,
        location,
        linked_actor_id,
        linked_actor_type,
        project_id,
        other_data
    )
    SELECT
        value->>'post_id',
        value->>'platform',
        value->>'post_url',
        value->>'author_handle',
        value->>'author_name',
        value->>'content_text',
        (value->>'post_timestamp')::timestamptz,
        (value->'media_urls')::jsonb,
        (value->>'media_count')::int,
        (value->>'like_count')::int,
        (value->>'reply_count')::int,
        (value->>'share_count')::int,
        (value->'mentioned_users')::jsonb,
        (value->'hashtags')::jsonb,
        value->>'location',
        (value->>'linked_actor_id')::uuid,
        value->>'linked_actor_type',
        (value->>'project_id')::uuid,
        (value->'other_data')::jsonb
    FROM jsonb_array_elements(posts)
    ON CONFLICT (post_id) DO NOTHING;

    -- Return results: newly inserted posts marked as inserted=true
    RETURN QUERY
    WITH input_posts AS (
        SELECT
            value->>'post_id' as pid
        FROM jsonb_array_elements(posts)
    ),
    inserted_posts AS (
        SELECT p.id, p.post_id, TRUE as was_inserted
        FROM v2_social_media_posts p
        INNER JOIN input_posts i ON p.post_id = i.pid
        WHERE p.created_at >= NOW() - INTERVAL '1 second'
    ),
    existing_posts AS (
        SELECT p.id, p.post_id, FALSE as was_inserted
        FROM v2_social_media_posts p
        INNER JOIN input_posts i ON p.post_id = i.pid
        WHERE p.created_at < NOW() - INTERVAL '1 second'
    )
    SELECT * FROM inserted_posts
    UNION ALL
    SELECT * FROM existing_posts;
END;
$$;

-- Check which post_ids already exist (for backwards compatibility)
CREATE FUNCTION check_existing_post_ids(post_ids TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN ARRAY(
        SELECT post_id
        FROM v2_social_media_posts
        WHERE post_id = ANY(post_ids)
    );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_posts_needing_media(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_update_post_images(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_insert_posts(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION check_existing_post_ids(TEXT[]) TO authenticated;

-- Grant to service_role for automation scripts
GRANT EXECUTE ON FUNCTION get_posts_needing_media(INT) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_update_post_images(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_insert_posts(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION check_existing_post_ids(TEXT[]) TO service_role;

-- Comments for documentation
COMMENT ON FUNCTION get_posts_needing_media(INT) IS
'Returns minimal data (id, media_url) for Instagram posts that need media downloaded. Excludes EXPIRED posts.';

COMMENT ON FUNCTION bulk_update_post_images(JSONB) IS
'Bulk updates offline_image_url for multiple posts in a single query. Expects JSONB array of {id, offline_image_url} objects.';

COMMENT ON FUNCTION bulk_insert_posts(JSONB) IS
'Bulk inserts posts with ON CONFLICT DO NOTHING on post_id. Returns which posts were inserted vs duplicates.';

COMMENT ON FUNCTION check_existing_post_ids(TEXT[]) IS
'Returns array of post_ids that already exist in the database. Used for duplicate checking.';
