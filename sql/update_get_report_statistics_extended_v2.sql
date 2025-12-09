-- Update get_report_statistics to NOT use v2_event_denorm table
-- Queries v2_events + v2_event_actor_links directly for accuracy
-- Extended with lobbying topics, improved university/church name formatting

CREATE OR REPLACE FUNCTION public.get_report_statistics(
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_stats jsonb;
  v_total_events integer;
  v_cities jsonb;
  v_states jsonb;
  v_top_people jsonb;
  v_top_chapters jsonb;
  v_top_orgs jsonb;
  v_universities jsonb;
  v_churches jsonb;
  v_categories jsonb;
  v_lobbying_topics jsonb;
  v_search text;
  v_location_city text;
  v_location_state text;
  v_actor_ids uuid[];
  v_project_ids uuid[];
BEGIN
  -- Extract filters from JSONB
  v_search := p_filters->>'search';
  v_location_city := p_filters->'location'->>'city';
  v_location_state := p_filters->'location'->>'state';
  v_actor_ids := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'actor_ids', '[]'::jsonb)))::uuid[];
  v_project_ids := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'project_ids', '[]'::jsonb)))::uuid[];

  -- Get total event count (querying v2_events directly)
  SELECT COUNT(*)
  INTO v_total_events
  FROM v2_events e
  WHERE
    e.event_date >= p_start_date::date
    AND e.event_date <= p_end_date::date
    AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
    AND (v_location_city IS NULL OR e.city = v_location_city)
    AND (v_location_state IS NULL OR e.state = v_location_state)
    -- Actor filter: event must have at least one of the specified actors linked
    AND (
      cardinality(v_actor_ids) = 0
      OR EXISTS (
        SELECT 1 FROM v2_event_actor_links eal
        WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids)
      )
    )
    -- Project filter: event must have at least one actor linked to the project
    AND (
      cardinality(v_project_ids) = 0
      OR EXISTS (
        SELECT 1
        FROM v2_event_actor_links eal
        JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
        WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
      )
    );

  -- Top cities
  SELECT jsonb_agg(jsonb_build_object('name', city, 'count', cnt))
  INTO v_cities
  FROM (
    SELECT e.city, COUNT(*) as cnt
    FROM v2_events e
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR EXISTS (SELECT 1 FROM v2_event_actor_links eal WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids))
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_event_actor_links eal
          JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
          WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND e.city IS NOT NULL
    GROUP BY e.city
    ORDER BY cnt DESC
    LIMIT 10
  ) cities;

  -- Top states
  SELECT jsonb_agg(jsonb_build_object('name', state, 'count', cnt))
  INTO v_states
  FROM (
    SELECT e.state, COUNT(*) as cnt
    FROM v2_events e
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR EXISTS (SELECT 1 FROM v2_event_actor_links eal WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids))
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_event_actor_links eal
          JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
          WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND e.state IS NOT NULL
    GROUP BY e.state
    ORDER BY cnt DESC
    LIMIT 10
  ) states;

  -- Top people (join through v2_event_actor_links)
  SELECT jsonb_agg(jsonb_build_object('name', actor_name, 'count', cnt))
  INTO v_top_people
  FROM (
    SELECT a.name as actor_name, COUNT(DISTINCT e.id) as cnt
    FROM v2_events e
    JOIN v2_event_actor_links eal ON eal.event_id = e.id
    JOIN v2_actors a ON a.id = eal.actor_id
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR eal.actor_id = ANY(v_actor_ids)
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_actor_projects ap
          WHERE ap.actor_id = eal.actor_id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND a.actor_type = 'person'
    GROUP BY a.name
    ORDER BY cnt DESC
    LIMIT 10
  ) people;

  -- Top chapters
  SELECT jsonb_agg(jsonb_build_object('name', actor_name, 'count', cnt))
  INTO v_top_chapters
  FROM (
    SELECT a.name as actor_name, COUNT(DISTINCT e.id) as cnt
    FROM v2_events e
    JOIN v2_event_actor_links eal ON eal.event_id = e.id
    JOIN v2_actors a ON a.id = eal.actor_id
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR eal.actor_id = ANY(v_actor_ids)
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_actor_projects ap
          WHERE ap.actor_id = eal.actor_id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND a.actor_type = 'chapter'
    GROUP BY a.name
    ORDER BY cnt DESC
    LIMIT 10
  ) chapters;

  -- Top organizations
  SELECT jsonb_agg(jsonb_build_object('name', actor_name, 'count', cnt))
  INTO v_top_orgs
  FROM (
    SELECT a.name as actor_name, COUNT(DISTINCT e.id) as cnt
    FROM v2_events e
    JOIN v2_event_actor_links eal ON eal.event_id = e.id
    JOIN v2_actors a ON a.id = eal.actor_id
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR eal.actor_id = ANY(v_actor_ids)
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_actor_projects ap
          WHERE ap.actor_id = eal.actor_id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND a.actor_type = 'organization'
    GROUP BY a.name
    ORDER BY cnt DESC
    LIMIT 10
  ) orgs;

  -- Top universities (from category_tags JSONB)
  -- Handles multiple formats:
  --   "School: Name" (space after colon)
  --   "School:Name_With_Underscores"
  --   "School:AZ_Name" (state prefix)
  --   "Institution:Name"
  SELECT jsonb_agg(jsonb_build_object('name', inst_name, 'count', cnt))
  INTO v_universities
  FROM (
    SELECT
      -- First strip prefix, then replace underscores, then strip state code if present
      REGEXP_REPLACE(
        REPLACE(
          CASE
            -- "School: Name" (with space) -> strip "School: " (8 chars)
            WHEN tag_value LIKE 'School: %' THEN SUBSTRING(tag_value FROM 9)
            -- "School:Name" (no space) -> strip "School:" (7 chars)
            WHEN tag_value LIKE 'School:%' THEN SUBSTRING(tag_value FROM 8)
            -- "Institution:Name" -> strip prefix
            WHEN tag_value LIKE 'Institution:%' THEN SUBSTRING(tag_value FROM 13)
            ELSE tag_value
          END,
          '_', ' '
        ),
        '^[A-Z]{2} ',  -- Strip leading state code like "AZ "
        ''
      ) as inst_name,
      COUNT(*) as cnt
    FROM v2_events e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.category_tags, '[]'::jsonb)) AS tag_value
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR EXISTS (SELECT 1 FROM v2_event_actor_links eal WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids))
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_event_actor_links eal
          JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
          WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND (tag_value ILIKE '%University%' OR tag_value ILIKE '%College%')
    GROUP BY
      REGEXP_REPLACE(
        REPLACE(
          CASE
            WHEN tag_value LIKE 'School: %' THEN SUBSTRING(tag_value FROM 9)
            WHEN tag_value LIKE 'School:%' THEN SUBSTRING(tag_value FROM 8)
            WHEN tag_value LIKE 'Institution:%' THEN SUBSTRING(tag_value FROM 13)
            ELSE tag_value
          END,
          '_', ' '
        ),
        '^[A-Z]{2} ',
        ''
      )
    ORDER BY cnt DESC
    LIMIT 10
  ) universities;

  -- Top churches (from category_tags starting with Church:)
  SELECT jsonb_agg(jsonb_build_object('name', church_name, 'count', cnt))
  INTO v_churches
  FROM (
    SELECT
      REPLACE(SUBSTRING(tag_value FROM 8), '_', ' ') as church_name,
      COUNT(*) as cnt
    FROM v2_events e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.category_tags, '[]'::jsonb)) AS tag_value
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR EXISTS (SELECT 1 FROM v2_event_actor_links eal WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids))
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_event_actor_links eal
          JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
          WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND tag_value LIKE 'Church:%'
    GROUP BY REPLACE(SUBSTRING(tag_value FROM 8), '_', ' ')
    ORDER BY cnt DESC
    LIMIT 10
  ) churches;

  -- Top lobbying topics (from category_tags starting with LobbyingTopic:)
  SELECT jsonb_agg(jsonb_build_object('name', topic_name, 'count', cnt))
  INTO v_lobbying_topics
  FROM (
    SELECT
      REPLACE(SUBSTRING(tag_value FROM 15), '_', ' ') as topic_name,
      COUNT(*) as cnt
    FROM v2_events e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.category_tags, '[]'::jsonb)) AS tag_value
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR EXISTS (SELECT 1 FROM v2_event_actor_links eal WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids))
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_event_actor_links eal
          JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
          WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND tag_value LIKE 'LobbyingTopic:%'
    GROUP BY REPLACE(SUBSTRING(tag_value FROM 15), '_', ' ')
    ORDER BY cnt DESC
    LIMIT 10
  ) lobbying_topics;

  -- Top category tags (parent categories from tags with colons)
  SELECT jsonb_agg(jsonb_build_object('name', category, 'count', cnt))
  INTO v_categories
  FROM (
    SELECT
      SPLIT_PART(tag_value, ':', 1) as category,
      COUNT(*) as cnt
    FROM v2_events e
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.category_tags, '[]'::jsonb)) AS tag_value
    WHERE
      e.event_date >= p_start_date::date
      AND e.event_date <= p_end_date::date
      AND (v_search IS NULL OR e.event_name ILIKE '%' || v_search || '%' OR e.event_description ILIKE '%' || v_search || '%')
      AND (v_location_city IS NULL OR e.city = v_location_city)
      AND (v_location_state IS NULL OR e.state = v_location_state)
      AND (
        cardinality(v_actor_ids) = 0
        OR EXISTS (SELECT 1 FROM v2_event_actor_links eal WHERE eal.event_id = e.id AND eal.actor_id = ANY(v_actor_ids))
      )
      AND (
        cardinality(v_project_ids) = 0
        OR EXISTS (
          SELECT 1 FROM v2_event_actor_links eal
          JOIN v2_actor_projects ap ON ap.actor_id = eal.actor_id
          WHERE eal.event_id = e.id AND ap.project_id = ANY(v_project_ids)
        )
      )
      AND tag_value LIKE '%:%'
    GROUP BY SPLIT_PART(tag_value, ':', 1)
    ORDER BY cnt DESC
    LIMIT 10
  ) categories;

  -- Build final response
  -- Note: cities, states use without top_ prefix for consistency with frontend
  v_stats := jsonb_build_object(
    'total_events', COALESCE(v_total_events, 0),
    'cities', COALESCE(v_cities, '[]'::jsonb),
    'states', COALESCE(v_states, '[]'::jsonb),
    'top_people', COALESCE(v_top_people, '[]'::jsonb),
    'top_chapters', COALESCE(v_top_chapters, '[]'::jsonb),
    'top_organizations', COALESCE(v_top_orgs, '[]'::jsonb),
    'universities', COALESCE(v_universities, '[]'::jsonb),
    'churches', COALESCE(v_churches, '[]'::jsonb),
    'categories', COALESCE(v_categories, '[]'::jsonb),
    'lobbying_topics', COALESCE(v_lobbying_topics, '[]'::jsonb)
  );

  RETURN v_stats;
END;
$function$;
