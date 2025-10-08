import { PIPELINE_STEPS, STEP_LABELS, type PipelineStep } from '../common/automation/steps';

const BASE_URL = '/api/automation';

export interface AutomationSettings {
  id: string;
  is_enabled: boolean;
  include_instagram: boolean;
  run_interval_hours: number;
  last_run_started_at?: string | null;
  last_run_completed_at?: string | null;
  next_run_at?: string | null;
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
    return response.json().catch(() => ({})).then(body => {
      const message = (body as any)?.error || `Request failed with status ${response.status}`;
      throw new Error(message);
    });
  }
  return response.json() as Promise<T>;
}

export async function fetchAutomationConfig(): Promise<{ settings: AutomationSettings; recentRuns: AutomationRun[] }>
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
