import { PIPELINE_STEPS, STEP_LABELS, type PipelineStep } from '../common/automation/steps';

const BASE_URL = '/api/automation';

export interface AutomationSettings {
  id: string;
  is_enabled: boolean;
  include_instagram: boolean;
  run_interval_hours: number;
  prompt_id?: string | null;
  twitter_handle_limit?: number;
  event_posts_limit?: number;
  dedup_events_limit?: number;
  max_results_per_user?: number;
  last_run_started_at?: string | null;
  last_run_completed_at?: string | null;
  next_run_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AutomationPrompt {
  id: string;
  name: string;
  description?: string | null;
  prompt_template: string;
  supports_tools: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CategoryTag {
  id: string;
  tag_name: string;
  tag_rule?: string | null;
  parent_tag?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface RunStepState {
  status: StepStatus | string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  log_tail?: string[];
  return_code?: number;
}

export interface AutomationRun {
  id: string;
  status: 'queued' | 'running' | 'failed' | 'succeeded' | string;
  current_step?: PipelineStep | string | null;
  include_instagram: boolean;
  triggered_by: string;
  scheduled_for?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  step_states?: Record<string, RunStepState> | null;
  config_snapshot?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    return response.json().catch(() => ({} as Record<string, unknown>)).then(body => {
      const message = typeof body === 'object' && body !== null && 'error' in body && typeof (body as Record<string, unknown>).error === 'string'
        ? String((body as Record<string, unknown>).error)
        : `Request failed with status ${response.status}`;
      throw new Error(message);
    });
  }
  return response.json() as Promise<T>;
}

export async function fetchAutomationConfig(): Promise<{
  settings: AutomationSettings;
  recentRuns: AutomationRun[];
  prompts: AutomationPrompt[];
}>
{
  const res = await fetch(`${BASE_URL}/config`);
  return handleResponse(res);
}

export async function updateAutomationConfig(payload: Partial<AutomationSettings>): Promise<AutomationSettings> {
  const res = await fetch(`${BASE_URL}/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await handleResponse<{ settings: AutomationSettings }>(res);
  return data.settings;
}

export async function listAutomationPrompts(): Promise<AutomationPrompt[]> {
  const res = await fetch(`${BASE_URL}/prompts`);
  const data = await handleResponse<{ prompts: AutomationPrompt[] }>(res);
  return data.prompts ?? [];
}

export async function createAutomationPrompt(payload: {
  name?: string;
  description?: string | null;
  prompt_template?: string;
  supports_tools?: boolean;
  is_default?: boolean;
}): Promise<AutomationPrompt> {
  const res = await fetch(`${BASE_URL}/prompts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await handleResponse<{ prompt: AutomationPrompt }>(res);
  return data.prompt;
}

export async function updateAutomationPrompt(id: string, payload: {
  name?: string;
  description?: string | null;
  prompt_template?: string;
  supports_tools?: boolean;
  is_default?: boolean;
}): Promise<AutomationPrompt> {
  const res = await fetch(`${BASE_URL}/prompts`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id, ...payload })
  });

  const data = await handleResponse<{ prompt: AutomationPrompt }>(res);
  return data.prompt;
}

export async function listCategoryTags(): Promise<CategoryTag[]> {
  const res = await fetch(`${BASE_URL}/category-tags`);
  const data = await handleResponse<{ categoryTags: CategoryTag[] }>(res);
  return data.categoryTags ?? [];
}

export async function createCategoryTag(payload: {
  tag_name: string;
  tag_rule?: string | null;
  parent_tag?: string | null;
  is_active?: boolean;
}): Promise<CategoryTag> {
  const res = await fetch(`${BASE_URL}/category-tags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await handleResponse<{ categoryTag: CategoryTag }>(res);
  return data.categoryTag;
}

export async function updateCategoryTag(id: string, payload: {
  tag_name?: string;
  tag_rule?: string | null;
  parent_tag?: string | null;
  is_active?: boolean;
}): Promise<CategoryTag> {
  const res = await fetch(`${BASE_URL}/category-tags`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id, ...payload })
  });

  const data = await handleResponse<{ categoryTag: CategoryTag }>(res);
  return data.categoryTag;
}

export async function triggerAutomationRun(options?: { include_instagram?: boolean; triggered_by?: string }): Promise<AutomationRun> {
  const res = await fetch(`${BASE_URL}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(options ?? {})
  });

  const data = await handleResponse<{ run: AutomationRun }>(res);
  return data.run;
}

export async function listAutomationRuns(limit = 10): Promise<AutomationRun[]> {
  const res = await fetch(`${BASE_URL}/runs?limit=${limit}`);
  const data = await handleResponse<{ runs: AutomationRun[] }>(res);
  return data.runs;
}

export async function getAutomationRun(id: string): Promise<AutomationRun | null> {
  const res = await fetch(`${BASE_URL}/runs?id=${encodeURIComponent(id)}`);
  if (res.status === 404) {
    return null;
  }
  const data = await handleResponse<{ run: AutomationRun }>(res);
  return data.run ?? null;
}

export function getStepOrder(): PipelineStep[] {
  return PIPELINE_STEPS.slice();
}

export function getStepLabel(step: PipelineStep | string): string {
  return STEP_LABELS[step as PipelineStep] ?? step;
}
