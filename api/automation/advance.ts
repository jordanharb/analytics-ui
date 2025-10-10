import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabaseClient } from '../_lib/supabase.js';
import { handleOptions, respondError, setCorsHeaders } from '../_lib/http.js';

const CRON_SECRET = process.env.AUTOMATION_CRON_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (handleOptions(req, res)) {
    return;
  }

  // Allow both GET (from Vercel cron) and POST (manual triggers)
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    respondError(res, 405, `Method ${req.method} not allowed`);
    return;
  }

  // Check authorization for POST requests or if secret is configured
  if (req.method === 'POST' && CRON_SECRET) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
      respondError(res, 401, 'Unauthorized');
      return;
    }
  }

  // For GET requests from Vercel cron, check the cron secret header if configured
  if (req.method === 'GET' && CRON_SECRET) {
    const cronSecret = req.headers['x-vercel-cron-secret'];
    if (!cronSecret || cronSecret !== CRON_SECRET) {
      respondError(res, 401, 'Unauthorized - Invalid cron secret');
      return;
    }
  }

  let supabase;
  try {
    supabase = getServiceSupabaseClient();
  } catch (error) {
    respondError(res, 500, 'Failed to initialize Supabase client', error);
    return;
  }

  try {
    const { data, error } = await supabase.rpc('schedule_automation_run');
    if (error) {
      throw error;
    }

    res.status(200).json(data ?? { scheduled: false, reason: 'unknown' });
  } catch (error: any) {
    respondError(res, 500, 'Failed to schedule automation run', error?.message ?? error);
  }
}
