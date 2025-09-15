-- Vector Search Functions for MCP Server
-- These functions enable semantic search on posts and events

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- Function: search_posts_by_embedding
-- Search social media posts using vector similarity
-- =====================================================
CREATE OR REPLACE FUNCTION public.search_posts_by_embedding(
    query_embedding vector,
    similarity_threshold float DEFAULT 0.7,
    match_limit int DEFAULT 50,
    filter_platform text DEFAULT NULL,
    filter_start_date timestamp with time zone DEFAULT NULL,
    filter_end_date timestamp with time zone DEFAULT NULL,
    filter_author_handles text[] DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    post_id text,
    platform text,
    post_url text,
    author_handle text,
    author_name text,
    content_text text,
    post_timestamp timestamp with time zone,
    like_count integer,
    reply_count integer,
    share_count integer,
    linked_actor_id uuid,
    linked_actor_type text,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.post_id,
        p.platform,
        p.post_url,
        p.author_handle,
        p.author_name,
        p.content_text,
        p.post_timestamp,
        p.like_count,
        p.reply_count,
        p.share_count,
        p.linked_actor_id,
        p.linked_actor_type,
        1 - (p.embedding <=> query_embedding) as similarity
    FROM v2_social_media_posts p
    WHERE
        -- Vector similarity filter
        p.embedding IS NOT NULL
        AND (1 - (p.embedding <=> query_embedding)) >= similarity_threshold
        -- Platform filter
        AND (filter_platform IS NULL OR p.platform = filter_platform)
        -- Date range filters
        AND (filter_start_date IS NULL OR p.post_timestamp >= filter_start_date)
        AND (filter_end_date IS NULL OR p.post_timestamp <= filter_end_date)
        -- Author filter
        AND (filter_author_handles IS NULL OR p.author_handle = ANY(filter_author_handles))
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_limit;
END;
$$;

-- =====================================================
-- Function: search_events_by_embedding
-- Search events using vector similarity
-- =====================================================
CREATE OR REPLACE FUNCTION public.search_events_by_embedding(
    query_embedding vector,
    similarity_threshold float DEFAULT 0.7,
    match_limit int DEFAULT 50,
    filter_start_date date DEFAULT NULL,
    filter_end_date date DEFAULT NULL,
    filter_states text[] DEFAULT NULL,
    filter_tags text[] DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    event_name text,
    event_date date,
    location text,
    city text,
    state text,
    event_description text,
    category_tags jsonb,
    confidence_score numeric,
    verified boolean,
    latitude numeric,
    longitude numeric,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.event_name,
        e.event_date,
        e.location,
        e.city,
        e.state,
        e.event_description,
        e.category_tags,
        e.confidence_score,
        e.verified,
        e.latitude,
        e.longitude,
        1 - (e.embedding <=> query_embedding) as similarity
    FROM v2_events e
    WHERE
        -- Vector similarity filter
        e.embedding IS NOT NULL
        AND (1 - (e.embedding <=> query_embedding)) >= similarity_threshold
        -- Date range filters
        AND (filter_start_date IS NULL OR e.event_date >= filter_start_date)
        AND (filter_end_date IS NULL OR e.event_date <= filter_end_date)
        -- State filter
        AND (filter_states IS NULL OR e.state = ANY(filter_states))
        -- Tag filter
        AND (
            filter_tags IS NULL
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(e.category_tags) AS tag
                WHERE tag = ANY(filter_tags)
            )
        )
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_limit;
END;
$$;

-- =====================================================
-- Function: find_similar_posts
-- Find posts similar to a given post
-- =====================================================
CREATE OR REPLACE FUNCTION public.find_similar_posts(
    target_id uuid,
    match_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    post_id text,
    platform text,
    author_handle text,
    content_text text,
    post_timestamp timestamp with time zone,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_embedding vector;
BEGIN
    -- Get the embedding of the target post
    SELECT embedding INTO target_embedding
    FROM v2_social_media_posts
    WHERE id = target_id;

    IF target_embedding IS NULL THEN
        RAISE EXCEPTION 'Post % does not have an embedding', target_id;
    END IF;

    -- Find similar posts
    RETURN QUERY
    SELECT
        p.id,
        p.post_id,
        p.platform,
        p.author_handle,
        p.content_text,
        p.post_timestamp,
        1 - (p.embedding <=> target_embedding) as similarity
    FROM v2_social_media_posts p
    WHERE
        p.id != target_id
        AND p.embedding IS NOT NULL
    ORDER BY p.embedding <=> target_embedding
    LIMIT match_limit;
END;
$$;

-- =====================================================
-- Function: find_similar_events
-- Find events similar to a given event
-- =====================================================
CREATE OR REPLACE FUNCTION public.find_similar_events(
    target_id uuid,
    match_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    event_name text,
    event_date date,
    city text,
    state text,
    category_tags jsonb,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_embedding vector;
BEGIN
    -- Get the embedding of the target event
    SELECT embedding INTO target_embedding
    FROM v2_events
    WHERE id = target_id;

    IF target_embedding IS NULL THEN
        RAISE EXCEPTION 'Event % does not have an embedding', target_id;
    END IF;

    -- Find similar events
    RETURN QUERY
    SELECT
        e.id,
        e.event_name,
        e.event_date,
        e.city,
        e.state,
        e.category_tags,
        1 - (e.embedding <=> target_embedding) as similarity
    FROM v2_events e
    WHERE
        e.id != target_id
        AND e.embedding IS NOT NULL
    ORDER BY e.embedding <=> target_embedding
    LIMIT match_limit;
END;
$$;

-- =====================================================
-- Function: execute_readonly_query
-- Execute read-only SQL queries safely
-- =====================================================
CREATE OR REPLACE FUNCTION public.execute_readonly_query(
    query_text text,
    query_params jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result jsonb;
    query_upper text;
BEGIN
    -- Validate query is read-only
    query_upper := upper(trim(query_text));

    IF NOT (
        query_upper LIKE 'SELECT%'
        OR query_upper LIKE 'WITH%'
        OR query_upper LIKE 'TABLE%'
        OR query_upper LIKE 'VALUES%'
    ) THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Forbid dangerous keywords
    IF query_upper ~ '(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL)' THEN
        RAISE EXCEPTION 'Query contains forbidden keywords';
    END IF;

    -- Execute query and return results as JSON
    EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text)
    INTO result
    USING query_params;

    RETURN COALESCE(result, '[]'::jsonb);
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Query execution failed: %', SQLERRM;
END;
$$;

-- =====================================================
-- Function: get_actor_network
-- Get the network of relationships for an actor
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_actor_network(
    actor_id uuid,
    depth int DEFAULT 1,
    max_nodes int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result jsonb;
    nodes jsonb := '[]'::jsonb;
    edges jsonb := '[]'::jsonb;
    current_actors uuid[] := ARRAY[actor_id];
    next_actors uuid[] := '{}';
    current_depth int := 0;
    node_count int := 0;
BEGIN
    -- Add initial actor as node
    WITH actor_data AS (
        SELECT
            a.id,
            a.name,
            a.actor_type,
            a.city,
            a.state
        FROM v2_actors a
        WHERE a.id = actor_id
    )
    SELECT jsonb_agg(row_to_json(actor_data)) INTO nodes FROM actor_data;

    -- Iterate through network depth
    WHILE current_depth < depth AND node_count < max_nodes LOOP
        -- Get connections for current actors
        WITH connections AS (
            SELECT DISTINCT
                CASE
                    WHEN al.from_actor_id = ANY(current_actors) THEN al.to_actor_id
                    ELSE al.from_actor_id
                END as connected_actor_id,
                al.relationship,
                al.role,
                CASE
                    WHEN al.from_actor_id = ANY(current_actors) THEN al.from_actor_id
                    ELSE al.to_actor_id
                END as source_actor_id
            FROM v2_actor_links al
            WHERE al.from_actor_id = ANY(current_actors)
                OR al.to_actor_id = ANY(current_actors)
        ),
        new_actors AS (
            SELECT DISTINCT c.connected_actor_id
            FROM connections c
            WHERE NOT c.connected_actor_id = ANY(current_actors)
            LIMIT (max_nodes - node_count)
        )
        SELECT array_agg(connected_actor_id) INTO next_actors FROM new_actors;

        EXIT WHEN next_actors IS NULL OR array_length(next_actors, 1) IS NULL;

        -- Add new nodes
        WITH actor_data AS (
            SELECT
                a.id,
                a.name,
                a.actor_type,
                a.city,
                a.state
            FROM v2_actors a
            WHERE a.id = ANY(next_actors)
        )
        SELECT nodes || jsonb_agg(row_to_json(actor_data)) INTO nodes FROM actor_data;

        -- Add edges
        WITH edge_data AS (
            SELECT
                al.from_actor_id as source,
                al.to_actor_id as target,
                al.relationship,
                al.role
            FROM v2_actor_links al
            WHERE (al.from_actor_id = ANY(current_actors) AND al.to_actor_id = ANY(next_actors))
                OR (al.to_actor_id = ANY(current_actors) AND al.from_actor_id = ANY(next_actors))
        )
        SELECT edges || jsonb_agg(row_to_json(edge_data)) INTO edges FROM edge_data;

        -- Update for next iteration
        current_actors := current_actors || next_actors;
        current_depth := current_depth + 1;
        node_count := jsonb_array_length(nodes);
    END LOOP;

    -- Build result
    result := jsonb_build_object(
        'nodes', nodes,
        'edges', edges,
        'depth_reached', current_depth,
        'node_count', jsonb_array_length(nodes)
    );

    RETURN result;
END;
$$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_posts_embedding ON v2_social_media_posts USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_events_embedding ON v2_events USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_actors_embedding ON v2_actors USING ivfflat (embedding vector_cosine_ops);

-- Grant permissions for MCP server
GRANT EXECUTE ON FUNCTION search_posts_by_embedding TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_events_by_embedding TO anon, authenticated;
GRANT EXECUTE ON FUNCTION find_similar_posts TO anon, authenticated;
GRANT EXECUTE ON FUNCTION find_similar_events TO anon, authenticated;
GRANT EXECUTE ON FUNCTION execute_readonly_query TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_actor_network TO anon, authenticated;