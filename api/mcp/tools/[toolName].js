import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY
);

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
    let result;

    switch (toolName) {
      case 'query_events':
        result = await queryEvents(args);
        break;
      case 'search_posts':
        result = await searchPosts(args);
        break;
      case 'analyze_trends':
        result = await analyzeTrends(args);
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

async function queryEvents(args) {
  const { filters = {} } = args;

  let query = supabase
    .from('v2_events')
    .select('*')
    .order('event_date', { ascending: false });

  if (filters.date_range?.start_date) {
    query = query.gte('event_date', filters.date_range.start_date);
  }
  if (filters.date_range?.end_date) {
    query = query.lte('event_date', filters.date_range.end_date);
  }
  if (filters.tags?.length) {
    // Use dynamic_slugs for tag filtering
    query = query.contains('dynamic_slugs', filters.tags);
  }
  if (filters.states?.length) {
    query = query.in('state', filters.states);
  }
  if (filters.cities?.length) {
    query = query.in('city', filters.cities);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  } else {
    query = query.limit(100);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

async function searchPosts(args) {
  const { query: searchQuery, platform = 'all', limit = 50 } = args;

  let query = supabase
    .from('v2_social_media_posts')
    .select('*')
    .or(`post_text.ilike.%${searchQuery}%,author_name.ilike.%${searchQuery}%`)
    .order('post_date', { ascending: false })
    .limit(limit);

  if (platform !== 'all') {
    query = query.eq('platform', platform);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

async function analyzeTrends(args) {
  const { metric, group_by = 'day', date_range } = args;

  // This would call specific Supabase functions or perform aggregations
  // For now, return a mock response
  return {
    metric,
    group_by,
    date_range,
    data: [
      { date: '2025-01-14', count: 15, label: 'Campus Events' },
      { date: '2025-01-15', count: 22, label: 'Social Media Activity' },
      { date: '2025-01-16', count: 18, label: 'Protests' },
    ],
    summary: `Analysis of ${metric} grouped by ${group_by}`,
  };
}