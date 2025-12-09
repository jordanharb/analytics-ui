import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabaseClient } from '../_lib/supabase.js';
import { handleOptions, readJsonBody, respondError, setCorsHeaders } from '../_lib/http.js';
import { DEFAULT_RUN_INTERVAL_HOURS } from '../../common/automation/steps.js';
import { loadDefaultPromptTemplate, DEFAULT_PROMPT_NAME, DEFAULT_PROMPT_DESCRIPTION } from '../_lib/promptTemplate.js';

const SETTINGS_TABLE = 'automation_settings';
const RUNS_TABLE = 'automation_runs';
const PROMPTS_TABLE = 'automation_prompts';

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
            run_interval_hours: DEFAULT_RUN_INTERVAL_HOURS,
            twitter_handle_limit: parseInt(process.env.TWITTER_HANDLE_LIMIT || '0', 10),
            event_posts_limit: parseInt(process.env.AUTOMATION_EVENT_POSTS_LIMIT || '300', 10),
            dedup_events_limit: parseInt(process.env.AUTOMATION_DEDUP_EVENTS_LIMIT || '20', 10),
            max_results_per_user: parseInt(process.env.MAX_RESULTS_PER_USER || '50', 10)
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

      const { data: promptsData, error: promptsError } = await supabase
        .from(PROMPTS_TABLE)
        .select('*')
        .order('created_at', { ascending: true });

      if (promptsError) {
        throw promptsError;
      }

      let prompts = promptsData ?? [];

      if (!prompts || prompts.length === 0) {
        const defaultTemplate = loadDefaultPromptTemplate();
        const { data: insertedPrompt, error: insertPromptError } = await supabase
          .from(PROMPTS_TABLE)
          .insert({
            name: DEFAULT_PROMPT_NAME,
            description: DEFAULT_PROMPT_DESCRIPTION,
            prompt_template: defaultTemplate,
            is_default: true
          })
          .select()
          .single();

        if (insertPromptError) {
          throw insertPromptError;
        }

        prompts = [insertedPrompt];
      }

      const defaultPrompt = prompts.find(prompt => prompt.is_default) ?? prompts[0] ?? null;

      if (settings && !settings.prompt_id && defaultPrompt) {
        const { data: updatedSettings, error: promptAttachError } = await supabase
          .from(SETTINGS_TABLE)
          .update({ prompt_id: defaultPrompt.id })
          .eq('id', settings.id)
          .select()
          .single();

        if (!promptAttachError && updatedSettings) {
          settings = updatedSettings;
        }
      }

      res.status(200).json({ settings, recentRuns, prompts });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respondError(res, 500, 'Failed to fetch automation config', message);
    }
    return;
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      const body = await readJsonBody(req);
      const {
        is_enabled,
        include_instagram,
        run_interval_hours,
        next_run_at,
        prompt_id,
        twitter_handle_limit,
        event_posts_limit,
        dedup_events_limit,
        max_results_per_user
      } = body as Record<string, unknown>;

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

      // Processing limit fields
      if (typeof twitter_handle_limit === 'number' && twitter_handle_limit >= 0) {
        updates.twitter_handle_limit = Math.round(twitter_handle_limit);
      }

      if (typeof event_posts_limit === 'number' && event_posts_limit > 0) {
        updates.event_posts_limit = Math.round(event_posts_limit);
      }

      if (typeof dedup_events_limit === 'number' && dedup_events_limit > 0) {
        updates.dedup_events_limit = Math.round(dedup_events_limit);
      }

      if (typeof max_results_per_user === 'number' && max_results_per_user > 0) {
        updates.max_results_per_user = Math.round(max_results_per_user);
      }

      if (typeof prompt_id === 'string') {
        // Basic validation to ensure prompt exists
        const { data: promptRow, error: promptLookupError } = await supabase
          .from(PROMPTS_TABLE)
          .select('id')
          .eq('id', prompt_id)
          .maybeSingle();

        if (promptLookupError) {
          throw promptLookupError;
        }

        if (!promptRow) {
          respondError(res, 400, 'Prompt not found');
          return;
        }

        updates.prompt_id = prompt_id;
      } else if (prompt_id === null) {
        updates.prompt_id = null;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respondError(res, 500, 'Failed to update automation config', message);
    }
    return;
  }

  res.setHeader('Allow', 'GET,POST,PATCH,OPTIONS');
  respondError(res, 405, `Method ${req.method} not allowed`);
}
