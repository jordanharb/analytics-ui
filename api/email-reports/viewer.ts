/**
 * Email Report Viewer API Endpoint
 * Fetches report data for public viewer page (no auth required)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Use anon key for public access (RLS policies allow viewing via token)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.query.token as string;

    if (!token) {
      return res.status(400).json({ error: 'Missing required query parameter: token' });
    }

    // Fetch report using RPC function (handles security via RLS)
    const { data, error } = await supabase
      .rpc('get_report_by_token', { p_viewer_token: token });

    if (error) {
      console.error('Error fetching report by token:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Report not found or not yet generated' });
    }

    const report = data[0];

    // Also fetch the actual events for the report period using same filters
    const { data: eventsData, error: eventsError } = await supabase
      .from('v2_events')
      .select('id, event_name, event_description, event_date, city, state, latitude, longitude')
      .gte('event_date', report.report_start_date)
      .lte('event_date', report.report_end_date)
      .order('event_date', { ascending: false })
      .limit(100); // Limit to 100 most recent events for viewer

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      // Don't fail the whole request, just return empty events
    }

    // Fetch FRESH statistics using the report's date range and filters
    // This ensures stats are always current, not from when report was generated
    let freshStatistics = report.statistics; // fallback to stored stats
    try {
      const { data: statsData, error: statsError } = await supabase.rpc('get_report_statistics', {
        p_start_date: report.report_start_date,
        p_end_date: report.report_end_date,
        p_filters: report.search_filters || {}
      });

      if (statsError) {
        console.error('Error fetching fresh statistics:', statsError);
      } else if (statsData) {
        freshStatistics = statsData;
      }
    } catch (statsErr) {
      console.error('Exception fetching fresh statistics:', statsErr);
    }

    // Fetch social media posts if we have featured post IDs
    let socialPosts: any[] = [];
    if (report.social_featured_post_ids && report.social_featured_post_ids.length > 0) {
      const { data: postsData, error: postsError } = await supabase
        .from('v2_social_media_posts')
        .select('id, author_name, author_handle, content_text, post_timestamp, platform')
        .in('id', report.social_featured_post_ids);

      if (postsError) {
        console.error('Error fetching social posts:', postsError);
      } else if (postsData) {
        // Preserve the order from social_featured_post_ids
        const postMap = new Map(postsData.map(p => [p.id, p]));
        socialPosts = report.social_featured_post_ids
          .map((id: string) => postMap.get(id))
          .filter(Boolean)
          .map((p: any) => ({
            id: p.id,
            display_name: p.author_name || p.author_handle || 'Unknown',
            author_handle: p.author_handle,
            content_text: p.content_text,
            post_timestamp: p.post_timestamp,
            platform: p.platform
          }));
      }
    }

    return res.status(200).json({
      report: {
        run_id: report.run_id,
        job_name: report.job_name,
        report_start_date: report.report_start_date,
        report_end_date: report.report_end_date,
        gemini_summary: report.gemini_summary,
        event_count: freshStatistics?.total_events ?? report.event_count,
        statistics: freshStatistics,
        search_filters: report.search_filters,
        created_at: report.created_at,
        events: eventsData || [],
        // Social media data
        social_insights: report.social_insights || null,
        social_posts: socialPosts
      }
    });
  } catch (error) {
    console.error('Email report viewer API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
