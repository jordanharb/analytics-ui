import type { Filters } from '../api/types';

export interface ConvertedDatePeriod {
  period_type: 'last_n_days' | 'last_week' | 'last_month' | 'custom_range';
  period_days?: number;
  custom_start_date?: string;
  custom_end_date?: string;
}

/**
 * Converts FilterPanel date format to EmailReportJobCreate format
 *
 * @param filters - The filters object from FilterPanel/useFiltersStore
 * @returns Converted period configuration for email report job
 */
export function convertDateFiltersToEmailPeriod(filters: Filters): ConvertedDatePeriod {
  // If custom date range is specified, use it
  if (filters.date_range?.start_date || filters.date_range?.end_date) {
    return {
      period_type: 'custom_range',
      custom_start_date: filters.date_range.start_date,
      custom_end_date: filters.date_range.end_date,
    };
  }

  // Convert period presets
  switch (filters.period) {
    case 'week':
      return {
        period_type: 'last_week',
      };

    case 'month':
      return {
        period_type: 'last_month',
      };

    case 'year':
      return {
        period_type: 'last_n_days',
        period_days: 365,
      };

    case 'all':
      return {
        period_type: 'last_n_days',
        period_days: 3650, // ~10 years
      };

    default:
      // Default to last week if no period specified
      return {
        period_type: 'last_week',
      };
  }
}

/**
 * Gets a human-readable description of the date period
 * Useful for displaying confirmation to user
 */
export function getDatePeriodDescription(converted: ConvertedDatePeriod): string {
  switch (converted.period_type) {
    case 'last_week':
      return 'Past 7 days (rolling)';

    case 'last_month':
      return 'Last calendar month';

    case 'last_n_days':
      return `Rolling ${converted.period_days} days (from today)`;

    case 'custom_range':
      const start = converted.custom_start_date || 'start';
      const end = converted.custom_end_date || 'end';
      return `Custom range: ${start} to ${end}`;

    default:
      return 'Unknown period';
  }
}
