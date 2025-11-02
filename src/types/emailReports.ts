/**
 * Email Reports types
 */

import type { Filters } from '../api/types';

export interface EmailReportJobCreate {
  name: string;
  description?: string;
  is_enabled?: boolean;

  // Time period
  period_type: 'last_n_days' | 'last_week' | 'last_month' | 'custom_range';
  period_days?: number;
  custom_start_date?: string;
  custom_end_date?: string;

  // Filters (same as map/directory)
  search_filters: Filters;

  // Recipients
  recipient_emails: string[];

  // Scheduling
  schedule_type: 'manual' | 'daily' | 'weekly' | 'monthly';
  schedule_day_of_week?: number; // 0-6 for weekly
  schedule_day_of_month?: number; // 1-31 for monthly
  schedule_time?: string; // HH:MM:SS format
}
