import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabaseClient } from '../_lib/supabase';
import { handleOptions, readJsonBody, respondError, setCorsHeaders } from '../_lib/http';

const SETTINGS_TABLE = 'automation_settings';
const RUNS_TABLE = 'automation_runs';

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

  let supabase;
  try {
    supabase = getServiceSupabaseClient();
  } catch (error) {
    respondError(res, 500, 'Failed to initialize Supabase client', error);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const { include_instagram, triggered_by } = body as Record<string, unknown>;

    const { data: settingsRows, error: settingsError } = await supabase
      .from(SETTINGS_TABLE)
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1);

    if (settingsError) {
      throw settingsError;
    }

    const settings = settingsRows?.[0];

    const useInstagram = typeof include_instagram === 'boolean'
      ? include_instagram
      : settings?.include_instagram ?? false;

    const triggerSource = typeof triggered_by === 'string' && triggered_by.length > 0
      ? triggered_by
      : 'manual';

    const { data: run, error: insertError } = await supabase
      .from(RUNS_TABLE)
      .insert({
        status: 'queued',
        include_instagram: useInstagram,
        triggered_by: triggerSource,
        scheduled_for: new Date().toISOString(),
        config_snapshot: {
          include_instagram: useInstagram,
          run_interval_hours: settings?.run_interval_hours ?? null
        }
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    res.status(200).json({ run });
  } catch (error: any) {
    respondError(res, 500, 'Failed to create automation run', error?.message ?? error);
  }
}
