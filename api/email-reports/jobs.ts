/**
 * Email Report Jobs API Endpoint
 * Handles CRUD operations for email report job configurations
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function sanitizeSearchFilters(filters: Record<string, any> | null | undefined) {
  if (!filters) return {};
  const { min_date, max_date, ...rest } = filters;
  return rest;
}

async function withSchemaRetry<T>(operation: () => Promise<T>, attempt: number = 1): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt === 1 && message.includes('schema cache')) {
      try {
        await supabase.rpc('reload_schema_cache');
      } catch (reloadError) {
        console.warn('Failed to reload schema cache:', reloadError);
      }
      return withSchemaRetry(operation, attempt + 1);
    }
    throw error;
  }
}

async function getDefaultPromptId(promptType: 'summary' | 'social'): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_report_prompts')
    .select('id')
    .eq('prompt_type', promptType)
    .eq('is_default', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`Failed to fetch default ${promptType} prompt:`, error);
    return null;
  }

  return data?.id ?? null;
}

export interface EmailReportJob {
  id: string;
  name: string;
  description?: string;
  is_enabled: boolean;
  include_social_insights?: boolean;
  summary_prompt_id?: string | null;
  social_prompt_id?: string | null;
  period_type: 'last_n_days' | 'last_week' | 'last_month' | 'custom_range';
  period_days?: number;
  custom_start_date?: string;
  custom_end_date?: string;
  search_filters: Record<string, any>;
  recipient_emails: string[];
  schedule_type: 'manual' | 'daily' | 'weekly' | 'monthly';
  schedule_day_of_week?: number;
  schedule_day_of_month?: number;
  schedule_time: string;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'PATCH':
        return await handlePatch(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Email report jobs API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}

/**
 * GET /api/email-reports/jobs
 * List all report jobs
 */
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const { data: jobs, error } = await supabase
    .from('email_report_jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return res.status(200).json({ jobs });
}

/**
 * POST /api/email-reports/jobs
 * Create new report job
 */
async function handlePost(req: VercelRequest, res: VercelResponse) {
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Partial<EmailReportJob>;

  // Validate required fields
  if (!body.name || !body.period_type || !body.recipient_emails || body.recipient_emails.length === 0 || !body.schedule_type) {
    return res.status(400).json({
      error: 'Missing required fields: name, period_type, recipient_emails, schedule_type'
    });
  }

  // Validate period_type specific fields
  if (body.period_type === 'last_n_days' && !body.period_days) {
    return res.status(400).json({ error: 'period_days required for last_n_days period_type' });
  }

  if (body.period_type === 'custom_range' && (!body.custom_start_date || !body.custom_end_date)) {
    return res.status(400).json({ error: 'custom_start_date and custom_end_date required for custom_range period_type' });
  }

  // Validate schedule_type specific fields
  if (body.schedule_type === 'weekly' && (body.schedule_day_of_week === undefined || body.schedule_day_of_week < 0 || body.schedule_day_of_week > 6)) {
    return res.status(400).json({ error: 'schedule_day_of_week (0-6) required for weekly schedule_type' });
  }

  if (body.schedule_type === 'monthly' && (body.schedule_day_of_month === undefined || body.schedule_day_of_month < 1 || body.schedule_day_of_month > 31)) {
    return res.status(400).json({ error: 'schedule_day_of_month (1-31) required for monthly schedule_type' });
  }

  const summaryPromptId = body.summary_prompt_id || await getDefaultPromptId('summary');
  const socialPromptId = body.social_prompt_id || await getDefaultPromptId('social');

  // Insert job
  const { data: job, error } = await withSchemaRetry(async () => {
    const result = await supabase
      .from('email_report_jobs')
      .insert({
        name: body.name,
        description: body.description,
        is_enabled: body.is_enabled ?? true,
        include_social_insights: body.include_social_insights ?? false,
        summary_prompt_id: summaryPromptId,
        social_prompt_id: socialPromptId,
        period_type: body.period_type,
        period_days: body.period_days,
        custom_start_date: body.custom_start_date,
        custom_end_date: body.custom_end_date,
        search_filters: sanitizeSearchFilters(body.search_filters),
        recipient_emails: body.recipient_emails,
        schedule_type: body.schedule_type,
        schedule_day_of_week: body.schedule_day_of_week,
        schedule_day_of_month: body.schedule_day_of_month,
        schedule_time: body.schedule_time ?? '09:00:00'
      })
      .select()
      .single();

    if (result.error) throw result.error;
    return result;
  });

  if (error) throw error;

  // Schedule next run if enabled and not manual
  if (job.is_enabled && job.schedule_type !== 'manual') {
    await supabase.rpc('schedule_next_report_run', { p_job_id: job.id });
  }

  return res.status(201).json({ job });
}

/**
 * PATCH /api/email-reports/jobs
 * Update existing report job
 */
async function handlePatch(req: VercelRequest, res: VercelResponse) {
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Partial<EmailReportJob> & { id: string };

  if (!body.id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  // Build update object (only include fields that are present)
  const updates: Partial<EmailReportJob> = {
    updated_at: new Date().toISOString()
  };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.is_enabled !== undefined) updates.is_enabled = body.is_enabled;
  if (body.period_type !== undefined) updates.period_type = body.period_type;
  if (body.period_days !== undefined) updates.period_days = body.period_days;
  if (body.custom_start_date !== undefined) updates.custom_start_date = body.custom_start_date;
  if (body.custom_end_date !== undefined) updates.custom_end_date = body.custom_end_date;
  if (body.search_filters !== undefined) {
    updates.search_filters = sanitizeSearchFilters(body.search_filters);
  }
  if (body.recipient_emails !== undefined) updates.recipient_emails = body.recipient_emails;
  if (body.schedule_type !== undefined) updates.schedule_type = body.schedule_type;
  if (body.schedule_day_of_week !== undefined) updates.schedule_day_of_week = body.schedule_day_of_week;
  if (body.schedule_day_of_month !== undefined) updates.schedule_day_of_month = body.schedule_day_of_month;
  if (body.schedule_time !== undefined) updates.schedule_time = body.schedule_time;
  if (body.include_social_insights !== undefined) updates.include_social_insights = body.include_social_insights;
  if (body.summary_prompt_id !== undefined) {
    updates.summary_prompt_id = body.summary_prompt_id ?? await getDefaultPromptId('summary');
  }
  if (body.social_prompt_id !== undefined) {
    updates.social_prompt_id = body.social_prompt_id ?? await getDefaultPromptId('social');
  }

  // Update job
  const { data: job, error } = await withSchemaRetry(async () => {
    const result = await supabase
      .from('email_report_jobs')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (result.error) throw result.error;
    return result;
  });

  if (error) throw error;

  // Reschedule next run if schedule settings changed
  if (body.schedule_type !== undefined || body.schedule_day_of_week !== undefined || body.schedule_day_of_month !== undefined || body.schedule_time !== undefined || body.is_enabled !== undefined) {
    if (job.is_enabled && job.schedule_type !== 'manual') {
      await supabase.rpc('schedule_next_report_run', { p_job_id: job.id });
    } else {
      // Clear next_run_at if disabled or manual
      await supabase
        .from('email_report_jobs')
        .update({ next_run_at: null })
        .eq('id', job.id);
    }
  }

  return res.status(200).json({ job });
}

/**
 * DELETE /api/email-reports/jobs?id={job_id}
 * Delete report job
 */
async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const jobId = req.query.id as string;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing required query parameter: id' });
  }

  const { error } = await supabase
    .from('email_report_jobs')
    .delete()
    .eq('id', jobId);

  if (error) throw error;

  return res.status(200).json({ success: true });
}
