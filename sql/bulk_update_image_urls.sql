-- Bulk update offline_image_url for migrated posts
-- This allows updating multiple posts in a single database call

-- Drop old versions first
DROP FUNCTION IF EXISTS bulk_update_image_urls(JSONB);
DROP FUNCTION IF EXISTS bulk_update_image_urls(TEXT);

CREATE OR REPLACE FUNCTION bulk_update_image_urls(updates TEXT)
RETURNS TABLE (
    updated_count INTEGER,
    success BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    update_count INTEGER := 0;
    updates_jsonb JSONB;
BEGIN
    -- Parse JSON string to JSONB
    updates_jsonb := updates::JSONB;

    -- Update all posts in one query using JSONB array
    WITH update_data AS (
        SELECT
            (value->>'id')::uuid as post_id,
            value->>'new_url' as new_url
        FROM jsonb_array_elements(updates_jsonb)
    )
    UPDATE v2_social_media_posts
    SET offline_image_url = d.new_url
    FROM update_data d
    WHERE v2_social_media_posts.id = d.post_id;

    GET DIAGNOSTICS update_count = ROW_COUNT;

    RETURN QUERY SELECT update_count, TRUE;
END;
$$;

COMMENT ON FUNCTION bulk_update_image_urls IS
'Bulk updates offline_image_url for multiple posts in a single query. Expects JSONB array of {id, new_url} objects.';
