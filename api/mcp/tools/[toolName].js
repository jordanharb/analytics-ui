import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const getSupabase = () => {
  return createClient(
    process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY
  );
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { toolName } = req.query;
  const args = req.body;

  try {
    const supabase = getSupabase();
    let result;

    switch (toolName) {
      case 'query_events':
        result = await queryEvents(supabase, args.filters || {});
        break;

      case 'search_posts':
        result = await searchPosts(supabase, args);
        break;

      case 'analyze_trends':
        result = await analyzeTrends(supabase, args);
        break;

      case 'get_filter_options':
        result = await getFilterOptions(supabase);
        break;

      default:
        return res.status(404).json({
          success: false,
          error: `Tool ${toolName} not found`
        });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Direct copy of EventAnalyzer.queryEvents
async function queryEvents(supabase, filters) {
  try {
    // IMPORTANT: Select specific columns, NOT * to avoid embedding columns
    let query = supabase
      .from('v2_events')
      .select(`
        id,
        event_name,
        event_date,
        event_description,
        location,
        city,
        state,
        latitude,
        longitude,
        category_tags,
        confidence_score,
        verified,
        dynamic_slugs,
        v2_event_actor_links!inner(
          actor_id,
          actor_handle,
          actor_type,
          platform
        ),
        v2_event_post_links(
          post_id,
          v2_social_media_posts(
            id,
            platform,
            post_text,
            post_date,
            author_name
          )
        )
      `);

    // Apply filters
    if (filters.date_range) {
      if (filters.date_range.start_date) {
        query = query.gte('event_date', filters.date_range.start_date);
      }
      if (filters.date_range.end_date) {
        query = query.lte('event_date', filters.date_range.end_date);
      }
    }

    if (filters.states?.length) {
      query = query.in('state', filters.states);
    }

    if (filters.cities?.length) {
      query = query.in('city', filters.cities);
    }

    if (filters.confidence_threshold) {
      query = query.gte('confidence_score', filters.confidence_threshold);
    }

    // Handle tag filtering
    if (filters.tags?.length) {
      const orConditions = filters.tags
        .map(tag => `category_tags.cs.[${JSON.stringify(tag)}]`)
        .join(',');
      query = query.or(orConditions);
    }

    // Limit and order
    query = query.limit(filters.limit || 100);
    query = query.order('event_date', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    // Process and format results
    const events = data?.map(event => ({
      id: event.id,
      name: event.event_name,
      date: event.event_date,
      location: {
        venue: event.location,
        city: event.city,
        state: event.state,
        coordinates: {
          latitude: event.latitude,
          longitude: event.longitude,
        },
      },
      description: event.event_description,
      tags: event.category_tags || [],
      dynamic_slugs: event.dynamic_slugs || [],
      confidence_score: event.confidence_score,
      verified: event.verified,
      actors: event.v2_event_actor_links?.map(link => ({
        id: link.actor_id,
        handle: link.actor_handle,
        type: link.actor_type,
        platform: link.platform,
      })) || [],
      posts: event.v2_event_post_links?.map(link => ({
        id: link.v2_social_media_posts?.id,
        platform: link.v2_social_media_posts?.platform,
        content: link.v2_social_media_posts?.post_text,
        timestamp: link.v2_social_media_posts?.post_date,
        author: link.v2_social_media_posts?.author_name,
      })) || [],
    })) || [];

    return {
      total_count: events.length,
      events: events,
      filters_applied: filters,
    };
  } catch (error) {
    throw new Error(`Failed to query events: ${error.message}`);
  }
}

// Simplified searchPosts without vector embeddings
async function searchPosts(supabase, args) {
  const { query: searchQuery, platform = 'all', limit = 50 } = args;

  try {
    // IMPORTANT: Select specific columns, NOT * to avoid embedding columns
    let query = supabase
      .from('v2_social_media_posts')
      .select(`
        id,
        platform,
        author_name,
        author_username,
        post_text,
        post_date,
        post_url,
        like_count,
        reply_count,
        repost_count,
        linked_actor_id
      `)
      .or(`post_text.ilike.%${searchQuery}%,author_name.ilike.%${searchQuery}%`)
      .order('post_date', { ascending: false })
      .limit(limit);

    if (platform !== 'all') {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Format results
    const posts = data?.map(post => ({
      id: post.id,
      platform: post.platform,
      author: {
        handle: post.author_username,
        name: post.author_name,
      },
      content: post.post_text,
      timestamp: post.post_date,
      engagement: {
        likes: post.like_count,
        replies: post.reply_count,
        shares: post.repost_count,
      },
      url: post.post_url,
      linked_actor_id: post.linked_actor_id,
    })) || [];

    return {
      query: searchQuery,
      total_results: posts.length,
      platform_filter: platform,
      posts: posts,
    };
  } catch (error) {
    throw new Error(`Failed to search posts: ${error.message}`);
  }
}

// Simplified analyzeTrends
async function analyzeTrends(supabase, args) {
  const { metric, group_by = 'day', date_range } = args;

  try {
    let query = supabase
      .from('v2_events')
      .select('event_date, state, city, category_tags, dynamic_slugs');

    // Apply date range
    if (date_range?.start_date) {
      query = query.gte('event_date', date_range.start_date);
    }
    if (date_range?.end_date) {
      query = query.lte('event_date', date_range.end_date);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Process data based on metric and grouping
    let results = {};

    if (metric === 'event_count') {
      if (group_by === 'day') {
        const countsByDay = {};
        data?.forEach(event => {
          const day = event.event_date?.split('T')[0];
          countsByDay[day] = (countsByDay[day] || 0) + 1;
        });
        results = {
          type: 'time_series',
          data: Object.entries(countsByDay).map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date))
        };
      } else if (group_by === 'state') {
        const countsByState = {};
        data?.forEach(event => {
          if (event.state) {
            countsByState[event.state] = (countsByState[event.state] || 0) + 1;
          }
        });
        results = {
          type: 'geographic',
          data: Object.entries(countsByState).map(([state, count]) => ({ state, count }))
            .sort((a, b) => b.count - a.count)
        };
      }
    } else if (metric === 'tag_frequency') {
      const tagCounts = {};
      data?.forEach(event => {
        event.category_tags?.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });
      results = {
        type: 'categories',
        data: Object.entries(tagCounts).map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20)
      };
    }

    return {
      metric,
      group_by,
      date_range,
      total_events_analyzed: data?.length || 0,
      results
    };
  } catch (error) {
    throw new Error(`Failed to analyze trends: ${error.message}`);
  }
}

// Get filter options
async function getFilterOptions(supabase) {
  try {
    const { data, error } = await supabase.rpc('get_filter_options_optimized');

    if (error) throw error;

    return {
      available_filters: data
    };
  } catch (error) {
    // Fallback to manual query
    const [statesResult, tagsResult] = await Promise.all([
      supabase.from('v2_events').select('state').distinct(),
      supabase.from('dynamic_slugs').select('slug, parent_slug').limit(100)
    ]);

    return {
      states: [...new Set(statesResult.data?.map(r => r.state).filter(Boolean))],
      tags: tagsResult.data || []
    };
  }
}