import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabaseClient } from '../_lib/supabase';
import { handleOptions, readJsonBody, respondError, setCorsHeaders } from '../_lib/http';
import { DEFAULT_RUN_INTERVAL_HOURS } from '../../common/automation/steps';

const SETTINGS_TABLE = 'automation_settings';
const RUNS_TABLE = 'automation_runs';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (handleOptions(req, res)) {
    return;
  }

  let supabase;
  try {
    supabase = getServiceSupabaseClient();
  } catch (error) {
    respondError(res, 500, 'Failed to initialize Supabase client', error);
    return;
  }

  if (req.method === 'GET') {
    try {
      const { data: settingsRows, error: settingsError } = await supabase
        .from(SETTINGS_TABLE)
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1);

      if (settingsError) {
        throw settingsError;
      }

      let settings = settingsRows && settingsRows[0];

      if (!settings) {
        const { data: inserted, error: insertError } = await supabase
          .from(SETTINGS_TABLE)
          .insert({
            is_enabled: false,
            include_instagram: false,
            run_interval_hours: DEFAULT_RUN_INTERVAL_HOURS
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        settings = inserted;
      }

      const { data: recentRuns, error: runsError } = await supabase
        .from(RUNS_TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (runsError) {
        throw runsError;
      }

      res.status(200).json({ settings, recentRuns });
    } catch (error: any) {
      respondError(res, 500, 'Failed to fetch automation config', error?.message ?? error);
    }
    return;
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      const body = await readJsonBody(req);
      const { is_enabled, include_instagram, run_interval_hours, next_run_at } = body as Record<string, unknown>;

      const interval = typeof run_interval_hours === 'number' && run_interval_hours > 0
        ? Math.round(run_interval_hours)
        : undefined;

      const updates: Record<string, unknown> = {};

      if (typeof is_enabled === 'boolean') {
        updates.is_enabled = is_enabled;
      }

      if (typeof include_instagram === 'boolean') {
        updates.include_instagram = include_instagram;
      }

      if (interval) {
        updates.run_interval_hours = interval;
      }

      if (typeof next_run_at === 'string') {
        updates.next_run_at = next_run_at;
      }

      if (Object.keys(updates).length === 0) {
        respondError(res, 400, 'No valid fields provided for update');
        return;
      }

      const { data: existingRows, error: existingError } = await supabase
        .from(SETTINGS_TABLE)
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1);

      if (existingError) {
        throw existingError;
      }

      if (!existingRows || existingRows.length === 0) {
        const { data: inserted, error: insertError } = await supabase
          .from(SETTINGS_TABLE)
          .insert(updates)
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        res.status(200).json({ settings: inserted });
        return;
      }

      const settingsId = existingRows[0].id;

      const { data: updated, error: updateError } = await supabase
        .from(SETTINGS_TABLE)
        .update(updates)
        .eq('id', settingsId)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.status(200).json({ settings: updated });
    } catch (error: any) {
      respondError(res, 500, 'Failed to update automation config', error?.message ?? error);
    }
    return;
  }

  res.setHeader('Allow', 'GET,POST,PATCH,OPTIONS');
  respondError(res, 405, `Method ${req.method} not allowed`);
}
