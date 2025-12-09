import type { Filters } from '../api/types';

export interface EmailReportPrompt {
  id: string;
  prompt_type: 'summary' | 'social';
  name: string;
  description?: string;
  prompt_template: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailReportJobCreate {
  name: string;
  description?: string;
  is_enabled?: boolean;
  include_social_insights?: boolean;

  period_type: 'last_n_days' | 'last_week' | 'last_month' | 'custom_range';
  period_days?: number;
  custom_start_date?: string | null;
  custom_end_date?: string | null;

  search_filters: Filters;
  recipient_emails: string[];

  schedule_type: 'manual' | 'daily' | 'weekly' | 'monthly';
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  schedule_time?: string;

  summary_prompt_id?: string | null;
  social_prompt_id?: string | null;
}

export interface EmailReportJob extends EmailReportJobCreate {
  id: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  search_filters: Filters;
}
