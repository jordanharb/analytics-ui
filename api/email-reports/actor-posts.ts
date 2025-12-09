/**
 * Actor Posts API Endpoint
 * Fetches social media posts for specific actors within a date range
 * Used by the report viewer to browse actor tweets
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface ActorPostsRequest {
  actorNames: string[];
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body as ActorPostsRequest;

    if (!body.actorNames || !Array.isArray(body.actorNames) || body.actorNames.length === 0) {
      return res.status(400).json({ error: 'actorNames array is required' });
    }

    if (!body.startDate || !body.endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const limit = Math.min(body.limit || 50, 100); // Max 100 per request
    const offset = body.offset || 0;

    // Call the paginated RPC function
    const { data, error } = await supabase.rpc('get_actor_social_posts_paginated', {
      p_actor_names: body.actorNames,
      p_start_date: body.startDate,
      p_end_date: body.endDate,
      p_limit: limit,
      p_offset: offset
    });

    if (error) {
      console.error('Error fetching actor posts:', error);
      throw error;
    }

    // Extract total count from first result (if available)
    const totalCount = data && data.length > 0 ? data[0].total_count : 0;

    // Transform the response
    const posts = (data || []).map((p: any) => ({
      id: p.id,
      display_name: p.display_name,
      author_handle: p.author_handle,
      content_text: p.content_text,
      post_timestamp: p.post_timestamp,
      platform: p.platform,
      matched_actor: p.matched_actor
    }));

    return res.status(200).json({
      posts,
      total_count: Number(totalCount),
      has_more: offset + posts.length < totalCount,
      limit,
      offset
    });
  } catch (error) {
    console.error('Actor posts API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
