import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabaseClient } from '../_lib/supabase';
import { handleOptions, respondError, setCorsHeaders } from '../_lib/http';

const CRON_SECRET = process.env.AUTOMATION_CRON_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    respondError(res, 405, `Method ${req.method} not allowed`);
    return;
  }

  if (CRON_SECRET) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
      respondError(res, 401, 'Unauthorized');
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
