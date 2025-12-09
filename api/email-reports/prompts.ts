/**
 * Email Report Prompts API Endpoint
 * Manage prompt templates for email reports (summary + social analysis)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface EmailReportPromptPayload {
  prompt_type: 'summary' | 'social';
  name: string;
  description?: string;
  prompt_template: string;
  set_default?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Email report prompts API error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const promptType = req.query.type as string | undefined;

  let query = supabase.from('email_report_prompts').select('*').order('updated_at', { ascending: false });

  if (promptType) {
    query = query.eq('prompt_type', promptType);
  }

  const { data, error } = await query;

  if (error) throw error;

  return res.status(200).json({ prompts: data || [] });
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as EmailReportPromptPayload;

  if (!body.prompt_type || !body.name || !body.prompt_template) {
    return res.status(400).json({
      error: 'Missing required fields: prompt_type, name, prompt_template'
    });
  }

  const { data: inserted, error } = await supabase
    .from('email_report_prompts')
    .insert({
      prompt_type: body.prompt_type,
      name: body.name,
      description: body.description,
      prompt_template: body.prompt_template,
      is_default: Boolean(body.set_default)
    })
    .select()
    .single();

  if (error) throw error;

  if (body.set_default && inserted) {
    await setPromptAsDefault(inserted.id, inserted.prompt_type);
  }

  return res.status(201).json({ prompt: inserted });
}

async function handlePatch(req: VercelRequest, res: VercelResponse) {
  const payloadBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { id, ...payload } = payloadBody as Partial<EmailReportPromptPayload> & { id?: string };

  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  const updates: Partial<EmailReportPromptPayload> & { is_default?: boolean } = {};

  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.prompt_template !== undefined) updates.prompt_template = payload.prompt_template;
  if (payload.prompt_type !== undefined) updates.prompt_type = payload.prompt_type;
  if (payload.set_default !== undefined) updates.is_default = Boolean(payload.set_default);

  const { data: updated, error } = await supabase
    .from('email_report_prompts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  if (payload.set_default && updated) {
    await setPromptAsDefault(updated.id, updated.prompt_type);
  }

  return res.status(200).json({ prompt: updated });
}

async function setPromptAsDefault(id: string, promptType: string) {
  await supabase
    .from('email_report_prompts')
    .update({ is_default: false })
    .eq('prompt_type', promptType)
    .neq('id', id);

  await supabase
    .from('email_report_prompts')
    .update({ is_default: true })
    .eq('id', id);
}
