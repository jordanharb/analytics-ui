import React, { useState, useEffect } from 'react';
import type { EmailReportJobCreate, EmailReportJob, EmailReportPrompt } from '../types/emailReports';
import { FilterPanel } from './FilterPanel/FilterPanel';
import { useFiltersStore } from '../state/filtersStore';
import { convertDateFiltersToEmailPeriod, getDatePeriodDescription } from '../utils/dateFilterConverter';

interface EmailReportJobFormProps {
  onSubmit: (job: EmailReportJobCreate) => Promise<void>;
  onCancel: () => void;
  prompts: {
    summary: EmailReportPrompt[];
    social: EmailReportPrompt[];
  };
  defaultSummaryPromptId?: string;
  defaultSocialPromptId?: string;
  initialJob?: EmailReportJob | null;
}

const formatTimeForInput = (value?: string | null) => {
  if (!value) return '09:00';
  if (value.length >= 5) return value.slice(0, 5);
  return value;
};

export const EmailReportJobForm: React.FC<EmailReportJobFormProps> = ({
  onSubmit,
  onCancel,
  prompts,
  defaultSummaryPromptId,
  defaultSocialPromptId,
  initialJob
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includeSocialInsights, setIncludeSocialInsights] = useState(true);

  const [recipientEmailsText, setRecipientEmailsText] = useState('');

  const [scheduleType, setScheduleType] = useState<'manual' | 'daily' | 'weekly' | 'monthly'>('weekly');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [scheduleTime, setScheduleTime] = useState('09:00');

  const [summaryPromptId, setSummaryPromptId] = useState('');
  const [socialPromptId, setSocialPromptId] = useState('');
  const [promptInitialized, setPromptInitialized] = useState(false);

  const { pendingFilters } = useFiltersStore();

  const [convertedPeriod, setConvertedPeriod] = useState(() => {
    const { date_range, ...filtersWithoutDateRange } = pendingFilters;
    return convertDateFiltersToEmailPeriod(filtersWithoutDateRange);
  });

  useEffect(() => {
    const { date_range, ...filtersWithoutDateRange } = pendingFilters;
    const converted = convertDateFiltersToEmailPeriod(filtersWithoutDateRange);
    setConvertedPeriod(converted);
  }, [pendingFilters.period, pendingFilters.date_range]);

  useEffect(() => {
    if (initialJob) {
      setName(initialJob.name || '');
      setDescription(initialJob.description || '');
      setIncludeSocialInsights(initialJob.include_social_insights ?? true);
      setRecipientEmailsText((initialJob.recipient_emails || []).join('\n'));
      setScheduleType(initialJob.schedule_type || 'weekly');
      setScheduleDayOfWeek(initialJob.schedule_day_of_week ?? 1);
      setScheduleDayOfMonth(initialJob.schedule_day_of_month ?? 1);
      setScheduleTime(formatTimeForInput(initialJob.schedule_time));
    } else {
      setName('');
      setDescription('');
      setIncludeSocialInsights(true);
      setRecipientEmailsText('');
      setScheduleType('weekly');
      setScheduleDayOfWeek(1);
      setScheduleDayOfMonth(1);
      setScheduleTime('09:00');
    }
    setPromptInitialized(false);
  }, [initialJob]);

  useEffect(() => {
    if (promptInitialized) return;

    const summaryDefault = initialJob?.summary_prompt_id
      || defaultSummaryPromptId
      || prompts.summary.find(p => p.is_default)?.id
      || prompts.summary[0]?.id
      || '';

    const socialDefault = initialJob?.social_prompt_id
      || defaultSocialPromptId
      || prompts.social.find(p => p.is_default)?.id
      || prompts.social[0]?.id
      || '';

    setSummaryPromptId(summaryDefault);
    setSocialPromptId(socialDefault);
    setPromptInitialized(true);
  }, [promptInitialized, initialJob, prompts, defaultSummaryPromptId, defaultSocialPromptId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const recipientEmails = recipientEmailsText
        .split(/[\n,]/)
        .map(e => e.trim())
        .filter(e => e.length > 0);

      if (recipientEmails.length === 0) {
        throw new Error('At least one recipient email is required');
      }

      const filters = {
        ...pendingFilters
      } as typeof pendingFilters & { min_date?: string; max_date?: string };

      delete filters.date_range;
      delete filters.min_date;
      delete filters.max_date;

      const normalizedScheduleTime = scheduleTime.length === 5 && scheduleTime.includes(':')
        ? `${scheduleTime}:00`
        : scheduleTime;

      const job: EmailReportJobCreate = {
        name: name.trim(),
        description: description.trim() || undefined,
        is_enabled: initialJob?.is_enabled ?? true,
        include_social_insights: includeSocialInsights,
        period_type: convertedPeriod.period_type,
        period_days: convertedPeriod.period_days,
        custom_start_date: convertedPeriod.custom_start_date,
        custom_end_date: convertedPeriod.custom_end_date,
        search_filters: filters,
        recipient_emails: recipientEmails,
        schedule_type: scheduleType,
        schedule_day_of_week: scheduleType === 'weekly' ? scheduleDayOfWeek : undefined,
        schedule_day_of_month: scheduleType === 'monthly' ? scheduleDayOfMonth : undefined,
        schedule_time: normalizedScheduleTime,
        summary_prompt_id: summaryPromptId || undefined,
        social_prompt_id: socialPromptId || undefined
      };

      await onSubmit(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save job');
    } finally {
      setLoading(false);
    }
  };

  const summaryPrompts = prompts.summary;
  const socialPrompts = prompts.social;

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

          <div className="flex items-start">
            <div className="flex items-center h-5">
              <input
                id="include-social-insights"
                type="checkbox"
                checked={includeSocialInsights}
                onChange={e => setIncludeSocialInsights(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
            </div>
            <div className="ml-3">
              <label htmlFor="include-social-insights" className="text-sm font-medium text-gray-700">
                Include Social Media Analysis
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Add AI-powered analysis of social media posts and conversations (recommended)
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Prompt Selection */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Prompt Templates</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Executive Summary Prompt
            </label>
            <select
              value={summaryPromptId}
              onChange={e => setSummaryPromptId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            >
              {summaryPrompts.length === 0 && <option value="">No prompts available</option>}
              {summaryPrompts.map(prompt => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}{prompt.is_default ? ' (Default)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500">
              This prompt controls the structure of the AI-generated executive summary.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Social Insights Prompt
            </label>
            <select
              value={socialPromptId}
              onChange={e => setSocialPromptId(e.target.value)}
              disabled={!includeSocialInsights}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 ${
                includeSocialInsights ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-100 text-gray-500'
              }`}
            >
              {socialPrompts.length === 0 && <option value="">No prompts available</option>}
              {socialPrompts.map(prompt => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}{prompt.is_default ? ' (Default)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500">
              Defines how the AI summarizes social media narratives. Disabled when social insights are off.
            </p>
          </div>
        </div>
      </div>

      {/* Filters (Same as Map/Directory) */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Event Filters & Time Period</h3>
        <p className="text-sm text-gray-600 mb-4">
          Use the same filters as the Map and Directory views to target specific events.
          The date range selected below will determine which events are included in the report.
        </p>

        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-blue-900">Report Period:</span>
            <span className="text-blue-700">{getDatePeriodDescription(convertedPeriod)}</span>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <FilterPanel hideDateFilter={false} />
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
        <p className="text-sm text-gray-600 mb-4">
          Specify how often this report should be automatically generated and sent.
        </p>
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
                onChange={e => setScheduleDayOfWeek(parseInt(e.target.value, 10))}
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
                onChange={e => setScheduleDayOfMonth(parseInt(e.target.value, 10))}
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

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
          {initialJob ? 'Save Changes' : 'Create Report'}
        </button>
      </div>
    </form>
  );
};
