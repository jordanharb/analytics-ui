import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EmailReportJobForm } from '../../components/EmailReportJobForm';
import type { EmailReportJobCreate, EmailReportPrompt, EmailReportJob } from '../../types/emailReports';
import promptsApi from '../../api/emailReportPrompts';
import { listEmailReportJobs, createEmailReportJob, updateEmailReportJob, deleteEmailReportJob, generateEmailReport } from '../../api/emailReportsService';
import type { Filters } from '../../api/types';
import { useFiltersStore } from '../../state/filtersStore';

export const EmailReportsView: React.FC = () => {
  const [jobs, setJobs] = useState<EmailReportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<{ mode: 'create' | 'edit'; job?: EmailReportJob } | null>(null);
  const [prompts, setPrompts] = useState<EmailReportPrompt[]>([]);
  const [promptDrafts, setPromptDrafts] = useState<{
    summary: { id?: string; name: string; description?: string; template: string };
    social: { id?: string; name: string; description?: string; template: string };
  }>({
    summary: { id: undefined, name: '', description: '', template: '' },
    social: { id: undefined, name: '', description: '', template: '' }
  });
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState<null | 'summary' | 'social'>(null);
  const filterSnapshotRef = useRef<Filters | null>(null);

  const buildPromptDraft = (prompt?: EmailReportPrompt) => ({
    id: prompt?.id,
    name: prompt?.name || '',
    description: prompt?.description || '',
    template: prompt?.prompt_template || ''
  });

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      setPromptLoading(true);
      setPromptError(null);
      const list = await promptsApi.list();
      setPrompts(list);

      const summaryDefault = list.find(p => p.prompt_type === 'summary' && p.is_default);
      const socialDefault = list.find(p => p.prompt_type === 'social' && p.is_default);

      setPromptDrafts({
        summary: buildPromptDraft(summaryDefault),
        social: buildPromptDraft(socialDefault)
      });
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Failed to load prompts');
    } finally {
      setPromptLoading(false);
    }
  };

  const cloneFilters = (filters: Filters | undefined) => {
    return JSON.parse(JSON.stringify(filters || {})) as Filters;
  };

  const snapshotFilters = () => {
    const state = useFiltersStore.getState();
    filterSnapshotRef.current = cloneFilters(state.pendingFilters as Filters);
  };

  const restoreFilters = () => {
    const state = useFiltersStore.getState();
    if (filterSnapshotRef.current) {
      state.resetFilters();
      state.setPendingFilters(filterSnapshotRef.current);
    } else {
      state.resetFilters();
    }
    filterSnapshotRef.current = null;
  };

  const applyJobFilters = (job: EmailReportJob) => {
    const state = useFiltersStore.getState();
    state.resetFilters();

    const filters = cloneFilters(job.search_filters as Filters | undefined);
    delete (filters as any).min_date;
    delete (filters as any).max_date;

    switch (job.period_type) {
      case 'last_week':
        filters.period = 'week';
        filters.date_range = undefined;
        break;
      case 'last_month':
        filters.period = 'month';
        filters.date_range = undefined;
        break;
      case 'last_n_days':
        if (job.period_days === 365) {
          filters.period = 'year';
        } else if (job.period_days === 7) {
          filters.period = 'week';
        } else {
          filters.period = 'all';
        }
        filters.date_range = undefined;
        break;
      case 'custom_range':
        filters.period = undefined;
        filters.date_range = {
          start_date: job.custom_start_date?.slice(0, 10),
          end_date: job.custom_end_date?.slice(0, 10)
        };
        break;
      default:
        break;
    }

    state.setPendingFilters(filters);
  };

  const fetchJobs = async () => {
    try {
      const response = await fetch('/api/email-reports/jobs');
      if (!response.ok) throw new Error('Failed to fetch jobs');
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (jobId: string, currentValue: boolean) => {
    try {
      const response = await fetch('/api/email-reports/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: jobId, is_enabled: !currentValue })
      });

      if (!response.ok) throw new Error('Failed to update job');
      await fetchJobs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update job');
    }
  };

  const handlePromptDraftChange = (
    type: 'summary' | 'social',
    field: 'name' | 'description' | 'template',
    value: string
  ) => {
    setPromptDrafts(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field === 'template' ? 'template' : field]: value
      }
    }));
  };

  const handlePromptSave = async (type: 'summary' | 'social', asNew: boolean = false) => {
    const draft = promptDrafts[type];
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setPromptError('Prompt name is required');
      return;
    }
    if (!draft.template.trim()) {
      setPromptError('Prompt template cannot be empty');
      return;
    }

    try {
      setPromptSaving(type);
      setPromptError(null);

      if (asNew || !draft.id) {
        await promptsApi.create({
          prompt_type: type,
          name: trimmedName,
          description: draft.description?.trim() || undefined,
          prompt_template: draft.template,
          set_default: true
        });
      } else {
        await promptsApi.update(draft.id, {
          name: trimmedName,
          description: draft.description?.trim() || undefined,
          prompt_template: draft.template,
          set_default: true
        });
      }

      await loadPrompts();
      alert(`Saved ${type === 'summary' ? 'Executive Summary' : 'Social Insights'} prompt`);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Failed to save prompt');
    } finally {
      setPromptSaving(null);
    }
  };

  const handlePromptSelect = (type: 'summary' | 'social', promptId: string) => {
    if (!promptId) {
      setPromptDrafts(prev => ({
        ...prev,
        [type]: buildPromptDraft(undefined)
      }));
      return;
    }

    const selected = prompts.find(p => p.id === promptId);
    if (selected) {
      setPromptDrafts(prev => ({
        ...prev,
        [type]: buildPromptDraft(selected)
      }));
    }
  };

  const handlePromptReset = (type: 'summary' | 'social') => {
    const defaultPrompt = prompts.find(p => p.prompt_type === type && p.is_default);
    setPromptDrafts(prev => ({
      ...prev,
      [type]: buildPromptDraft(defaultPrompt)
    }));
  };

  const summaryPrompts = useMemo(
    () => prompts.filter(prompt => prompt.prompt_type === 'summary'),
    [prompts]
  );

  const socialPrompts = useMemo(
    () => prompts.filter(prompt => prompt.prompt_type === 'social'),
    [prompts]
  );

  const summaryDefaultPrompt = useMemo(
    () => summaryPrompts.find(prompt => prompt.is_default) || summaryPrompts[0],
    [summaryPrompts]
  );

  const socialDefaultPrompt = useMemo(
    () => socialPrompts.find(prompt => prompt.is_default) || socialPrompts[0],
    [socialPrompts]
  );

  const openCreateForm = () => {
    snapshotFilters();
    useFiltersStore.getState().resetFilters();
    setFormState({ mode: 'create' });
  };

  const openEditForm = (job: EmailReportJob) => {
    snapshotFilters();
    applyJobFilters(job);
    setFormState({ mode: 'edit', job });
  };

  const handleFormCancel = () => {
    restoreFilters();
    setFormState(null);
  };

  const handleJobSubmit = async (payload: EmailReportJobCreate) => {
    if (formState?.mode === 'edit' && formState.job) {
      const response = await fetch('/api/email-reports/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: formState.job.id, ...payload })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to update job');
      }

      await fetchJobs();
      alert('Report job updated successfully!');
    } else {
      const response = await fetch('/api/email-reports/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to create job');
      }

      await fetchJobs();
      alert('Report job created successfully!');
    }

    restoreFilters();
    setFormState(null);
  };

  const handleGenerateNow = async (jobId: string) => {
    if (!confirm('Generate report now?')) return;

    try {
      const response = await fetch('/api/email-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId })
      });

      if (!response.ok) throw new Error('Failed to generate report');
      alert('Report queued for generation! Check your email shortly.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate report');
    }
  };

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    if (!confirm(`Delete job "${jobName}"?`)) return;

    try {
      const response = await fetch(`/api/email-reports/jobs?id=${jobId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete job');
      await fetchJobs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete job');
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getScheduleDescription = (job: EmailReportJob) => {
    switch (job.schedule_type) {
      case 'manual':
        return 'Manual only';
      case 'daily':
        return `Daily at ${job.schedule_time}`;
      case 'weekly':
        return `Weekly at ${job.schedule_time}`;
      case 'monthly':
        return `Monthly at ${job.schedule_time}`;
      default:
        return job.schedule_type;
    }
  };

  const getPeriodDescription = (job: EmailReportJob) => {
    switch (job.period_type) {
      case 'last_n_days':
        return `Rolling ${job.period_days || 7} days (from today)`;
      case 'last_week':
        return 'Past 7 days (rolling)';
      case 'last_month':
        return 'Last calendar month';
      case 'custom_range':
        return 'Custom date range (fixed)';
      default:
        return job.period_type;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Email Reports</h1>
            <p className="text-gray-600 mt-2">Automated email reports with AI summaries</p>
          </div>
          <button
            onClick={openCreateForm}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            + Create Report Job
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {formState && (
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {formState.mode === 'create' ? 'Create Email Report Job' : 'Edit Email Report Job'}
          </h2>
          <EmailReportJobForm
            onSubmit={handleJobSubmit}
            onCancel={handleFormCancel}
            prompts={{ summary: summaryPrompts, social: socialPrompts }}
            defaultSummaryPromptId={summaryDefaultPrompt?.id}
            defaultSocialPromptId={socialDefaultPrompt?.id}
            initialJob={formState.mode === 'edit' ? formState.job : null}
          />
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Prompt Templates</h2>
            <p className="text-gray-600 mt-2">
              Adjust the AI prompts used for the executive summary and social media analysis.
            </p>
          </div>
          <button
            onClick={loadPrompts}
            className="self-start md:self-auto px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Refresh Prompts
          </button>
        </div>

        {promptError && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {promptError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {(['summary', 'social'] as const).map(type => {
            const draft = promptDrafts[type];
            const defaultPrompt = prompts.find(p => p.prompt_type === type && p.is_default);
            const label = type === 'summary' ? 'Executive Summary Prompt' : 'Social Insights Prompt';
            const typePrompts = prompts.filter(p => p.prompt_type === type);
            return (
              <div key={type} className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{label}</h3>
                  {promptLoading && (
                    <span className="text-xs text-gray-500">Loading...</span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Load Existing Prompt</label>
                    <div className="flex gap-3 items-center">
                      <select
                        value={draft.id || ''}
                        onChange={e => handlePromptSelect(type, e.target.value)}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">New Prompt</option>
                        {typePrompts.map(prompt => (
                          <option key={prompt.id} value={prompt.id}>
                            {prompt.name}{prompt.is_default ? ' (Default)' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handlePromptReset(type)}
                        className="px-3 py-2 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Name</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => handlePromptDraftChange(type, 'name', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      placeholder={`Default ${label}`}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea
                      value={draft.description || ''}
                      onChange={e => handlePromptDraftChange(type, 'description', e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                      placeholder="Optional description for internal reference"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Template</label>
                    <textarea
                      value={draft.template}
                      onChange={e => handlePromptDraftChange(type, 'template', e.target.value)}
                      rows={18}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Use placeholders like <code>{'{top_cities}'}</code> or <code>{'{report_summary_preview}'}</code> as shown in the default templates.
                    </p>
                  </div>

                  {defaultPrompt && (
                    <p className="text-xs text-gray-500">
                      Current default: <span className="font-medium">{defaultPrompt.name}</span> (updated {new Date(defaultPrompt.updated_at).toLocaleString()})
                    </p>
                  )}

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={() => handlePromptSave(type, false)}
                      disabled={promptSaving === type}
                      className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => handlePromptSave(type, true)}
                      disabled={promptSaving === type}
                      className="px-4 py-2 rounded-md border border-blue-600 text-blue-600 text-sm font-semibold hover:bg-blue-50 disabled:opacity-60"
                    >
                      Save as New Default
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Jobs List */}
      {jobs.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="text-6xl mb-4">📧</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No Report Jobs Yet</h3>
          <p className="text-gray-600 mb-6">Create your first automated email report to get started.</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Create First Report
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const summaryPromptName = prompts.find(p => p.id === job.summary_prompt_id)?.name
              || summaryDefaultPrompt?.name
              || 'Default';
            const socialPromptName = prompts.find(p => p.id === job.social_prompt_id)?.name
              || socialDefaultPrompt?.name
              || 'Default';

            return (
            <div
              key={job.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-semibold text-gray-900">{job.name}</h3>
                    {job.is_enabled ? (
                      <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                        Enabled
                      </span>
                    ) : (
                      <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-medium">
                        Disabled
                      </span>
                    )}
                  </div>

                  {job.description && (
                    <p className="text-gray-600 mb-4">{job.description}</p>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Period:</span>
                      <div className="font-medium text-gray-900">{getPeriodDescription(job)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Schedule:</span>
                      <div className="font-medium text-gray-900">{getScheduleDescription(job)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Run:</span>
                      <div className="font-medium text-gray-900">{formatDate(job.last_run_at)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Next Run:</span>
                      <div className="font-medium text-gray-900">{formatDate(job.next_run_at)}</div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <span className="text-gray-500 text-sm">Recipients: </span>
                    <span className="text-gray-700 text-sm">{job.recipient_emails.join(', ')}</span>
                  </div>

                  <div className="mt-3 text-xs text-gray-500 space-y-1">
                    <div>
                      <span className="font-semibold text-gray-600">Summary Prompt:</span> {summaryPromptName}
                    </div>
                    {job.include_social_insights !== false && (
                      <div>
                        <span className="font-semibold text-gray-600">Social Prompt:</span> {socialPromptName}
                      </div>
                    )}
                    {job.include_social_insights === false && (
                      <div className="italic text-gray-400">Social insights disabled for this job</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 ml-6">
                  <button
                    onClick={() => openEditForm(job)}
                    className="bg-white border border-blue-200 text-blue-600 px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-50 transition-colors"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => handleToggleEnabled(job.id, job.is_enabled)}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                      job.is_enabled
                        ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        : 'bg-green-100 hover:bg-green-200 text-green-700'
                    }`}
                  >
                    {job.is_enabled ? 'Disable' : 'Enable'}
                  </button>

                  <button
                    onClick={() => handleGenerateNow(job.id)}
                    className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                  >
                    Run Now
                  </button>

                  <button
                    onClick={() => handleDeleteJob(job.id, job.name)}
                    className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
};
