import React, { useState } from 'react';
import type { EmailReportJobCreate } from '../types/emailReports';
import { FilterPanel } from './FilterPanel/FilterPanel';
import { useFiltersStore } from '../state/filtersStore';

interface EmailReportJobFormProps {
  onSubmit: (job: EmailReportJobCreate) => Promise<void>;
  onCancel: () => void;
}

export const EmailReportJobForm: React.FC<EmailReportJobFormProps> = ({ onSubmit, onCancel }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Time period
  const [periodType, setPeriodType] = useState<'last_n_days' | 'last_week' | 'last_month' | 'custom_range'>('last_week');
  const [periodDays, setPeriodDays] = useState(7);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Recipients
  const [recipientEmailsText, setRecipientEmailsText] = useState('');

  // Schedule
  const [scheduleType, setScheduleType] = useState<'manual' | 'daily' | 'weekly' | 'monthly'>('weekly');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1); // Monday
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [scheduleTime, setScheduleTime] = useState('09:00');

  // Get filters from global store (managed by FilterPanel)
  const { pendingFilters } = useFiltersStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Parse recipient emails
      const recipientEmails = recipientEmailsText
        .split(/[,\n]/)
        .map(e => e.trim())
        .filter(e => e.length > 0);

      if (recipientEmails.length === 0) {
        throw new Error('At least one recipient email is required');
      }

      // Use filters from FilterPanel (pendingFilters from store)
      const filters = { ...pendingFilters };

      // Build job object
      const job: EmailReportJobCreate = {
        name: name.trim(),
        description: description.trim() || undefined,
        is_enabled: true,
        period_type: periodType,
        period_days: periodType === 'last_n_days' ? periodDays : undefined,
        custom_start_date: periodType === 'custom_range' ? customStartDate : undefined,
        custom_end_date: periodType === 'custom_range' ? customEndDate : undefined,
        search_filters: filters,
        recipient_emails: recipientEmails,
        schedule_type: scheduleType,
        schedule_day_of_week: scheduleType === 'weekly' ? scheduleDayOfWeek : undefined,
        schedule_day_of_month: scheduleType === 'monthly' ? scheduleDayOfMonth : undefined,
        schedule_time: `${scheduleTime}:00`,
      };

      await onSubmit(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Report Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Weekly Activity Report"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Optional description of this report"
            />
          </div>
        </div>
      </div>

      {/* Report Time Period */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Report Time Period</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period Type</label>
            <select
              value={periodType}
              onChange={e => setPeriodType(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="last_week">Last Week</option>
              <option value="last_month">Last Month</option>
              <option value="last_n_days">Last N Days</option>
              <option value="custom_range">Custom Date Range</option>
            </select>
          </div>

          {periodType === 'last_n_days' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Number of Days</label>
              <input
                type="number"
                min="1"
                max="365"
                value={periodDays}
                onChange={e => setPeriodDays(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {periodType === 'custom_range' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  required={periodType === 'custom_range'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  required={periodType === 'custom_range'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters (Same as Map/Directory) */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Event Filters</h3>
        <p className="text-sm text-gray-600 mb-4">
          Use the same filters as the Map and Directory views to target specific events.
        </p>
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <FilterPanel />
        </div>
      </div>

      {/* Recipients */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recipients</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email Addresses * (one per line or comma-separated)
          </label>
          <textarea
            value={recipientEmailsText}
            onChange={e => setRecipientEmailsText(e.target.value)}
            rows={3}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="email1@example.com&#10;email2@example.com"
          />
        </div>
      </div>

      {/* Schedule */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Schedule</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Type</label>
            <select
              value={scheduleType}
              onChange={e => setScheduleType(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="manual">Manual Only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {scheduleType === 'weekly' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
              <select
                value={scheduleDayOfWeek}
                onChange={e => setScheduleDayOfWeek(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
            </div>
          )}

          {scheduleType === 'monthly' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Day of Month</label>
              <input
                type="number"
                min="1"
                max="31"
                value={scheduleDayOfMonth}
                onChange={e => setScheduleDayOfMonth(parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {scheduleType !== 'manual' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 justify-end pt-4 border-t">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          )}
          Create Report Job
        </button>
      </div>
    </form>
  );
};
