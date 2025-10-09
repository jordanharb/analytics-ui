import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabaseClient } from '../_lib/supabase';
import { handleOptions, respondError, setCorsHeaders } from '../_lib/http';

const RUNS_TABLE = 'automation_runs';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    respondError(res, 405, `Method ${req.method} not allowed`);
    return;
  }

  let supabase;
  try {
    supabase = getServiceSupabaseClient();
  } catch (error) {
    respondError(res, 500, 'Failed to initialize Supabase client', error);
    return;
  }

  try {
    if (typeof req.query.id === 'string') {
      const { data, error } = await supabase
        .from(RUNS_TABLE)
        .select('*')
        .eq('id', req.query.id)
        .single();

      if (error) {
        throw error;
      }

      res.status(200).json({ run: data });
      return;
    }

    const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 10;

    const { data, error } = await supabase
      .from(RUNS_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    res.status(200).json({ runs: data ?? [] });
  } catch (error: any) {
    respondError(res, 500, 'Failed to fetch automation runs', error?.message ?? error);
  }
}
