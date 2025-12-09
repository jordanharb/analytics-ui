/**
 * Email Report Generation API Endpoint
 * Triggers report generation for a job (creates run record, queues for processing)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function generateViewerToken(): string {
  return randomBytes(32).toString('base64url');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { job_id, send_email = true } = req.body as {
      job_id: string;
      send_email?: boolean;
    };

    if (!job_id) {
      return res.status(400).json({ error: 'Missing required field: job_id' });
    }

    // Fetch job to verify it exists
    const { data: job, error: jobError } = await supabase
      .from('email_report_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Generate viewer token
    const viewerToken = generateViewerToken();
    const viewerUrl = `/reports/view/${viewerToken}`;

    // Calculate report period dates based on job configuration
    const now = new Date();
    let reportStartDate: Date;
    let reportEndDate: Date = now;

    switch (job.period_type) {
      case 'last_n_days':
        reportStartDate = new Date(now);
        reportStartDate.setDate(now.getDate() - (job.period_days || 7));
        break;

      case 'last_week':
        // Rolling seven-day window ending now
        reportEndDate = new Date(now);
        reportStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;

      case 'last_month':
        // Last complete month
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        reportEndDate = new Date(firstOfThisMonth.getTime() - 1); // Last day of previous month
        reportStartDate = new Date(reportEndDate.getFullYear(), reportEndDate.getMonth(), 1);
        break;

      case 'custom_range':
        reportStartDate = new Date(job.custom_start_date);
        reportEndDate = new Date(job.custom_end_date);
        break;

      default:
        return res.status(400).json({ error: `Invalid period_type: ${job.period_type}` });
    }

    // Create report run record
    const { data: run, error: runError } = await supabase
      .from('email_report_runs')
      .insert({
        job_id,
        report_start_date: reportStartDate.toISOString(),
        report_end_date: reportEndDate.toISOString(),
        viewer_token: viewerToken,
        viewer_url: viewerUrl,
        status: 'pending'
      })
      .select()
      .single();

    if (runError) throw runError;

    // Note: Actual report generation happens via Python worker
    // The worker polls for 'pending' runs and processes them
    // For immediate generation, you could trigger the worker here via a queue/webhook

    return res.status(201).json({
      run,
      message: 'Report queued for generation. Check status via run.status field.'
    });
  } catch (error) {
    console.error('Email report generation API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
