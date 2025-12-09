import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FocusEvent } from 'react';
import type {
  AutomationRun,
  AutomationSettings,
} from '../../api/automationService';
import {
  fetchAutomationConfig,
  updateAutomationConfig,
  triggerAutomationRun,
  listAutomationRuns,
  getStepOrder,
  getStepLabel,
  listAutomationPrompts,
  createAutomationPrompt,
  updateAutomationPrompt,
  listCategoryTags,
  createCategoryTag,
  updateCategoryTag
} from '../../api/automationService';
import type { AutomationPrompt, CategoryTag } from '../../api/automationService';

type CategoryFormState = {
  id?: string;
  tag_name: string;
  tag_rule: string;
  parent_tag: string;
  is_active: boolean;
};
// import type { PipelineStep } from '../../common/automation/steps';

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const REFRESH_INTERVAL_MS = 30_000;

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-amber-600 bg-amber-100',
  running: 'text-sky-600 bg-sky-100',
  failed: 'text-red-600 bg-red-100',
  succeeded: 'text-emerald-600 bg-emerald-100',
  completed: 'text-emerald-600 bg-emerald-100',
  skipped: 'text-gray-600 bg-gray-100',
  pending: 'text-gray-600 bg-gray-100'
};

const STATUS_DOT: Record<string, string> = {
  queued: 'bg-amber-500',
  running: 'bg-sky-500',
  failed: 'bg-red-500',
  succeeded: 'bg-emerald-500',
  completed: 'bg-emerald-500',
  skipped: 'bg-gray-400'
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch {
    return value;
  }
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function useAutoRefresh(callback: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(callback, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [callback, enabled]);
}

export function AutomationView() {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [pendingSettings, setPendingSettings] = useState<Partial<AutomationSettings>>({});
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggeringRun, setTriggeringRun] = useState(false);
  const [prompts, setPrompts] = useState<AutomationPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [promptEditor, setPromptEditor] = useState({
    name: '',
    description: '',
    template: ''
  });
  const [promptSupportsTools, setPromptSupportsTools] = useState(true);
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [categoryTags, setCategoryTags] = useState<CategoryTag[]>([]);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);

  // Computed values for current config (pending or saved)
  const currentSettings = useMemo(() => {
    if (!settings) return null;
    return { ...settings, ...pendingSettings };
  }, [settings, pendingSettings]);

  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(pendingSettings).length > 0;
  }, [pendingSettings]);

  const applyPromptToEditor = useCallback((prompt: AutomationPrompt | null) => {
    if (prompt) {
      setPromptEditor({
        name: prompt.name,
        description: prompt.description ?? '',
        template: prompt.prompt_template
      });
      setPromptSupportsTools(prompt.supports_tools);
      setSelectedPromptId(prompt.id);
    } else {
      setPromptEditor({ name: '', description: '', template: '' });
      setPromptSupportsTools(true);
      setSelectedPromptId(null);
    }
    setPromptDirty(false);
  }, []);

  const refreshPrompts = useCallback(async (preferredId?: string) => {
    try {
      const promptList = await listAutomationPrompts();
      setPrompts(promptList);

      const activeId = preferredId
        ?? settings?.prompt_id
        ?? promptList.find(prompt => prompt.is_default)?.id
        ?? promptList[0]?.id
        ?? null;

      const activePrompt = activeId
        ? promptList.find(prompt => prompt.id === activeId) ?? null
        : null;

      applyPromptToEditor(activePrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load prompts';
      setError(message);
    }
  }, [applyPromptToEditor, settings?.prompt_id]);

  const refreshCategoryTags = useCallback(async () => {
    try {
      const tags = await listCategoryTags();
      setCategoryTags(tags);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load category tags';
      setError(message);
    }
  }, []);

  // const hasActiveRun = useMemo(() => runs.some(run => run.status === 'running'), [runs]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [configResponse, categoryResponse] = await Promise.all([
        fetchAutomationConfig(),
        listCategoryTags()
      ]);

      setSettings(configResponse.settings);
      setRuns(configResponse.recentRuns ?? []);
      setCategoryTags(categoryResponse);

      const promptList = configResponse.prompts ?? [];
      setPrompts(promptList);

      const activePromptId = configResponse.settings?.prompt_id
        ?? promptList.find(prompt => prompt.is_default)?.id
        ?? promptList[0]?.id
        ?? null;

      const activePrompt = activePromptId
        ? promptList.find(prompt => prompt.id === activePromptId) ?? null
        : null;

      applyPromptToEditor(activePrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load automation status';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [applyPromptToEditor]);

  const refreshRuns = useCallback(async () => {
    try {
      const data = await listAutomationRuns(10);
      setRuns(data ?? []);
    } catch (err) {
      console.error('Failed to refresh automation runs', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useAutoRefresh(() => {
    refreshRuns();
  }, true);

  const updatePendingSettings = useCallback((updates: Partial<AutomationSettings>) => {
    setPendingSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const handleSaveSettings = useCallback(async () => {
    if (!hasUnsavedChanges) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await updateAutomationConfig(pendingSettings);
      setSettings(updated);
      setPendingSettings({});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [pendingSettings, hasUnsavedChanges]);

  const handleDiscardChanges = useCallback(() => {
    setPendingSettings({});
    setError(null);
  }, []);

  const handleToggleEnabled = useCallback(() => {
    if (!currentSettings) return;
    updatePendingSettings({ is_enabled: !currentSettings.is_enabled });
  }, [updatePendingSettings, currentSettings]);

  const handleToggleInstagram = useCallback(() => {
    if (!currentSettings) return;
    updatePendingSettings({ include_instagram: !currentSettings.include_instagram });
  }, [updatePendingSettings, currentSettings]);

  const handleIntervalChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (Number.isFinite(value) && value > 0) {
      updatePendingSettings({ run_interval_hours: value });
    }
  }, [updatePendingSettings]);

  const handleTwitterLimitChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (Number.isFinite(value) && value >= 0) {
      updatePendingSettings({ twitter_handle_limit: value });
    }
  }, [updatePendingSettings]);

  const handleEventPostsLimitChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (Number.isFinite(value) && value > 0) {
      updatePendingSettings({ event_posts_limit: value });
    }
  }, [updatePendingSettings]);

  const handleDedupLimitChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (Number.isFinite(value) && value > 0) {
      updatePendingSettings({ dedup_events_limit: value });
    }
  }, [updatePendingSettings]);

  const handleMaxResultsChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (Number.isFinite(value) && value > 0) {
      updatePendingSettings({ max_results_per_user: value });
    }
  }, [updatePendingSettings]);

  const handleRunNow = useCallback(async () => {
    setTriggeringRun(true);
    try {
      const run = await triggerAutomationRun();
      setRuns(prev => [run, ...prev]);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start automation run';
      setError(message);
    } finally {
      setTriggeringRun(false);
    }
  }, []);

  const handlePromptSelectChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const promptId = event.target.value || null;
    const prompt = promptId ? prompts.find(item => item.id === promptId) ?? null : null;
    applyPromptToEditor(prompt);
    setError(null);
  }, [applyPromptToEditor, prompts]);

  const handlePromptFieldChange = useCallback((field: 'name' | 'description', value: string) => {
    setPromptEditor(prev => ({ ...prev, [field]: value }));
    setPromptDirty(true);
  }, []);

  const handlePromptTemplateChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setPromptEditor(prev => ({ ...prev, template: value }));
    setPromptDirty(true);
  }, []);

  const handlePromptSupportsToolsToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPromptSupportsTools(event.target.checked);
    setPromptDirty(true);
  }, []);

  // Resolve currently selected/active prompts before any callbacks use them
  const selectedPrompt = selectedPromptId ? prompts.find(prompt => prompt.id === selectedPromptId) ?? null : null;
  const activePrompt = settings?.prompt_id ? prompts.find(prompt => prompt.id === settings.prompt_id) ?? null : null;
  const isActivePromptSelected = Boolean(selectedPromptId && settings?.prompt_id && selectedPromptId === settings.prompt_id);
  const canSavePrompt = Boolean(promptDirty && selectedPromptId && !promptSaving);
  const canApplyPrompt = Boolean(selectedPromptId && !saving);

  const handleResetPromptEditor = useCallback(() => {
    applyPromptToEditor(selectedPrompt ?? null);
    setError(null);
  }, [applyPromptToEditor, selectedPrompt]);

  const handleSavePrompt = useCallback(async () => {
    if (!selectedPromptId) {
      setError('Select a prompt to update');
      return;
    }

    const name = promptEditor.name.trim();
    const template = promptEditor.template.trim();

    if (!name) {
      setError('Prompt name is required');
      return;
    }

    if (!template) {
      setError('Prompt content is required');
      return;
    }

    setError(null);
    setPromptSaving(true);
    try {
      const updated = await updateAutomationPrompt(selectedPromptId, {
        name,
        description: promptEditor.description.trim() || null,
        prompt_template: template,
        supports_tools: promptSupportsTools
      });

      await refreshPrompts(updated.id);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save prompt';
      setError(message);
    } finally {
      setPromptSaving(false);
    }
  }, [promptEditor.description, promptEditor.name, promptEditor.template, promptSupportsTools, refreshPrompts, selectedPromptId]);

  const handleSavePromptAsNew = useCallback(async () => {
    const name = promptEditor.name.trim() || `Prompt ${new Date().toISOString().slice(0, 10)}`;
    const template = promptEditor.template.trim();

    if (!template) {
      setError('Prompt content is required');
      return;
    }

    setError(null);
    setPromptSaving(true);
    try {
      const created = await createAutomationPrompt({
        name,
        description: promptEditor.description.trim() || null,
        prompt_template: template,
        supports_tools: promptSupportsTools
      });

      await refreshPrompts(created.id);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create prompt';
      setError(message);
    } finally {
      setPromptSaving(false);
    }
  }, [promptEditor.description, promptEditor.name, promptEditor.template, promptSupportsTools, refreshPrompts]);

  const handleApplyPromptToAutomation = useCallback(() => {
    if (!selectedPromptId) {
      setError('Select a prompt before applying');
      return;
    }
    setError(null);
    updatePendingSettings({ prompt_id: selectedPromptId });
  }, [updatePendingSettings, selectedPromptId]);

  const handleEditCategory = useCallback((tag: CategoryTag) => {
    setCategoryForm({
      id: tag.id,
      tag_name: tag.tag_name,
      tag_rule: tag.tag_rule ?? '',
      parent_tag: tag.parent_tag ?? '',
      is_active: tag.is_active
    });
    setError(null);
  }, []);

  const handleCreateCategory = useCallback(() => {
    setCategoryForm({
      tag_name: '',
      tag_rule: '',
      parent_tag: '',
      is_active: true
    });
    setError(null);
  }, []);

  const handleCategoryFieldChange = useCallback(<K extends keyof CategoryFormState>(field: K, value: CategoryFormState[K]) => {
    setCategoryForm(prev => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const handleCategorySave = useCallback(async () => {
    if (!categoryForm) {
      return;
    }

    const tagName = categoryForm.tag_name.trim();

    setError(null);
    if (!tagName) {
      setError('Category tag name is required');
      return;
    }

    setCategorySaving(true);
    try {
      if (categoryForm.id) {
        await updateCategoryTag(categoryForm.id, {
          tag_name: tagName,
          tag_rule: categoryForm.tag_rule.trim() || null,
          parent_tag: categoryForm.parent_tag.trim() || null,
          is_active: categoryForm.is_active
        });
      } else {
        await createCategoryTag({
          tag_name: tagName,
          tag_rule: categoryForm.tag_rule.trim() || null,
          parent_tag: categoryForm.parent_tag.trim() || null,
          is_active: categoryForm.is_active
        });
      }

      await refreshCategoryTags();
      setCategoryForm(null);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save category tag';
      setError(message);
    } finally {
      setCategorySaving(false);
    }
  }, [categoryForm, refreshCategoryTags]);

  const handleCategoryCancel = useCallback(() => {
    setCategoryForm(null);
  }, []);

  const stepOrder = useMemo(() => getStepOrder(), []);
  // (moved selectedPrompt/activePrompt/can* above to avoid TDZ in callbacks)

  return (
    <div className="px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Automation Control</h1>
          <p className="mt-1 text-slate-600">
            Manage the end-to-end social monitoring pipeline. Configure schedules, monitor runs, and trigger manual executions.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRunNow}
          disabled={triggeringRun}
          className={classNames(
            'inline-flex items-center rounded-md border border-transparent px-4 py-2 text-sm font-medium shadow-sm transition',
            triggeringRun ? 'bg-slate-400 text-white cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          )}
        >
          {triggeringRun ? 'Starting…' : 'Run Pipeline Now'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white px-6 py-10 text-center text-slate-500 shadow-sm">
          Loading automation status…
        </div>
      ) : (
        <div className="space-y-6">
          {currentSettings ? (
            <>
              {/* Status Banner */}
              <div className={classNames(
                "rounded-xl border-2 p-6 shadow-sm",
                currentSettings.is_enabled ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={classNames(
                      "flex h-12 w-12 items-center justify-center rounded-full",
                      currentSettings.is_enabled ? "bg-emerald-100" : "bg-slate-200"
                    )}>
                      <svg className={classNames("h-6 w-6", currentSettings.is_enabled ? "text-emerald-600" : "text-slate-400")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {currentSettings.is_enabled ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        )}
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {currentSettings.is_enabled ? "Automation Enabled" : "Automation Disabled"}
                      </h2>
                      <p className="text-sm text-slate-600">
                        {currentSettings.is_enabled
                          ? `Next run: ${formatDate(settings?.next_run_at) || "Calculating..."}`
                          : "Enable automation to schedule automatic pipeline runs"
                        }
                      </p>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="toggle-switch h-6 w-11 rounded-full bg-slate-200"
                      checked={currentSettings.is_enabled}
                      onChange={handleToggleEnabled}
                      disabled={saving}
                    />
                  </label>
                </div>
              </div>

              {/* Configuration Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Job Configuration</h3>

                <dl className="space-y-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-slate-700">Run every</dt>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={6}
                        step={1}
                        value={currentSettings.run_interval_hours}
                        onChange={handleIntervalChange}
                        className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-right text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        disabled={saving}
                      />
                      <span className="text-slate-500">hours</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-slate-700">Include Instagram</dt>
                    <input
                      type="checkbox"
                      checked={currentSettings.include_instagram}
                      onChange={handleToggleInstagram}
                      disabled={saving}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Processing Limits Section */}
                  <div className="pt-4 border-t border-slate-200">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3">Processing Limits</h4>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <dt className="text-sm text-slate-600">Twitter handles per run</dt>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={currentSettings.twitter_handle_limit || 0}
                            onChange={handleTwitterLimitChange}
                            className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            disabled={saving}
                          />
                          <span className="text-xs text-slate-500">(0 = unlimited)</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <dt className="text-sm text-slate-600">Event posts limit</dt>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={currentSettings.event_posts_limit || 300}
                          onChange={handleEventPostsLimitChange}
                          className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          disabled={saving}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <dt className="text-sm text-slate-600">Dedup events limit</dt>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={currentSettings.dedup_events_limit || 20}
                          onChange={handleDedupLimitChange}
                          className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          disabled={saving}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <dt className="text-sm text-slate-600">Max results per user</dt>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={currentSettings.max_results_per_user || 50}
                          onChange={handleMaxResultsChange}
                          className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-right text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          disabled={saving}
                        />
                      </div>
                    </div>
                  </div>
                </dl>

                {/* Action Buttons */}
                <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSaveSettings}
                      disabled={!hasUnsavedChanges || saving}
                      className={classNames(
                        "inline-flex items-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition",
                        hasUnsavedChanges && !saving
                          ? "bg-indigo-600 text-white hover:bg-indigo-700"
                          : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      )}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    {hasUnsavedChanges && (
                      <button
                        type="button"
                        onClick={handleDiscardChanges}
                        disabled={saving}
                        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                      >
                        Discard
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRunNow}
                    disabled={triggeringRun || hasUnsavedChanges}
                    className={classNames(
                      "inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium shadow-sm transition",
                      triggeringRun || hasUnsavedChanges
                        ? "border-slate-300 bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                    )}
                  >
                    {triggeringRun ? 'Starting...' : 'Run Now'}
                  </button>
                </div>
                {hasUnsavedChanges && (
                  <p className="mt-2 text-xs text-amber-600">
                    ⚠️ You have unsaved changes. Save or discard before running.
                  </p>
                )}
              </div>

              {/* Current Status */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Current Status</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Track the latest pipeline execution and each processing stage.
                    </p>
                  </div>
                  <span
                    className={classNames(
                      'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
                      STATUS_COLORS[(runs[0]?.status ?? '').toLowerCase()] || 'text-slate-600 bg-slate-100'
                    )}
                  >
                    {runs[0]?.status ? runs[0]?.status.toUpperCase() : 'IDLE'}
                  </span>
                </div>

                {runs.length > 0 ? (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700">Run ID</span>
                        <span className="text-slate-500">{runs[0].id.slice(0, 8)}…</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-slate-600">
                        <span>Started</span>
                        <span>{formatDate(runs[0].started_at)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-slate-600">
                        <span>Instagram enabled</span>
                        <span>{runs[0].include_instagram ? 'Yes' : 'No'}</span>
                      </div>
                    </div>

                    <ul className="space-y-2">
                      {stepOrder.map(step => {
                        const state = runs[0].step_states?.[step];
                        const status = state?.status ?? (runs[0].status === 'queued' ? 'pending' : 'pending');
                        const badgeClasses = STATUS_COLORS[status.toLowerCase()] || 'text-slate-600 bg-slate-100';
                        const dotClasses = STATUS_DOT[status.toLowerCase()] || 'bg-slate-400';
                        return (
                          <li key={step} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className={`h-2.5 w-2.5 rounded-full ${dotClasses}`} aria-hidden="true" />
                              <div>
                                <p className="text-sm font-medium text-slate-800">{getStepLabel(step)}</p>
                                <p className="text-xs text-slate-500">
                                  {state?.started_at ? `Started ${formatDate(state.started_at)} · ${formatDuration(state.duration_seconds)}` : 'Awaiting execution'}
                                </p>
                              </div>
                            </div>
                            <span className={classNames('rounded-full px-3 py-1 text-xs font-medium', badgeClasses)}>
                              {status.toUpperCase()}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-6 text-sm text-slate-500">No automation runs found yet.</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Event Processor Prompt</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Edit the instruction template that seeds each Gemini batch before category tag data is injected.
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <p className="text-sm text-slate-600">
                      Active prompt: <span className="font-medium text-slate-800">{activePrompt?.name ?? 'Default Event Prompt'}</span>
                    </p>
                    <button
                      type="button"
                      onClick={handleApplyPromptToAutomation}
                      disabled={!canApplyPrompt || isActivePromptSelected}
                      className={classNames(
                        'inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium transition',
                        isActivePromptSelected
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600 cursor-not-allowed'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100'
                      )}
                    >
                      {isActivePromptSelected ? 'In Use' : 'Use For Next Run'}
                    </button>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="prompt-selector" className="block text-sm font-medium text-slate-700">
                      Prompt variant
                    </label>
                    <select
                      id="prompt-selector"
                      value={selectedPromptId ?? ''}
                      onChange={handlePromptSelectChange}
                      className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {prompts.map(prompt => (
                        <option key={prompt.id} value={prompt.id}>
                          {prompt.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="prompt-name" className="block text-sm font-medium text-slate-700">
                        Prompt name
                      </label>
                      <input
                        id="prompt-name"
                        type="text"
                        value={promptEditor.name}
                        onChange={event => handlePromptFieldChange('name', event.target.value)}
                        className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-between md:justify-end">
                      <label className="mt-6 inline-flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={promptSupportsTools}
                          onChange={handlePromptSupportsToolsToggle}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Supports function tools
                      </label>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="prompt-description" className="block text-sm font-medium text-slate-700">
                      Description (optional)
                    </label>
                    <input
                      id="prompt-description"
                      type="text"
                      value={promptEditor.description}
                      onChange={event => handlePromptFieldChange('description', event.target.value)}
                      className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="Short summary for teammates"
                    />
                  </div>

                  <div>
                    <label htmlFor="prompt-template" className="block text-sm font-medium text-slate-700">
                      Prompt template
                    </label>
                    <textarea
                      id="prompt-template"
                      value={promptEditor.template}
                      onChange={handlePromptTemplateChange}
                      rows={18}
                      className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Keep placeholder tokens intact: <code>{'{{TOOL_INSTRUCTIONS}}'}</code>, <code>{'{{ACTOR_BIO_SECTION}}'}</code>, <code>{'{{EXISTING_SLUGS_SECTION}}'}</code>, <code>{'{{CATEGORY_TAG_DEFINITIONS}}'}</code>, <code>{'{{ALLOWED_CATEGORY_TAGS}}'}</code>.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleSavePrompt}
                      disabled={!canSavePrompt}
                      className={classNames(
                        'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition',
                        canSavePrompt
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'bg-slate-300 text-slate-600 cursor-not-allowed'
                      )}
                    >
                      {promptSaving && canSavePrompt ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSavePromptAsNew}
                      disabled={promptSaving}
                      className={classNames(
                        'inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition',
                        promptSaving
                          ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                      )}
                    >
                      Save as New Prompt
                    </button>
                    <button
                      type="button"
                      onClick={handleResetPromptEditor}
                      disabled={promptSaving || !promptDirty}
                      className={classNames(
                        'inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition',
                        promptSaving || !promptDirty
                          ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                      )}
                    >
                      Revert Changes
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Category Tags</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Maintain the tag catalogue consumed by the event processor and Gemini prompt.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100"
                  >
                    Add Category
                  </button>
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border border-slate-100">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Tag</th>
                        <th className="px-4 py-3 text-left">Parent</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Rule</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {categoryTags.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                            No category tags found. Create one to get started.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {categoryTags.map(tag => (
                            <>
                              <tr key={tag.id}>
                                <td className="px-4 py-3 font-medium text-slate-700">{tag.tag_name}</td>
                                <td className="px-4 py-3 text-slate-600">{tag.parent_tag ?? '—'}</td>
                                <td className="px-4 py-3">
                                  <span
                                  className={classNames(
                                    'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                                    tag.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                                  )}
                                >
                                  {tag.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                <span className="line-clamp-2 text-xs text-slate-500">{tag.tag_rule ?? '—'}</span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleEditCategory(tag)}
                                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                            {categoryForm && categoryForm.id === tag.id && (
                              <tr key={`${tag.id}-edit`}>
                                <td colSpan={5} className="px-0 py-0">
                                  <div className="border-t-2 border-indigo-200 bg-indigo-50 p-4">
                                    <div className="grid gap-4 md:grid-cols-2">
                                      <div>
                                        <label htmlFor="category-name" className="block text-sm font-medium text-slate-700">
                                          Tag name
                                        </label>
                                        <input
                                          id="category-name"
                                          type="text"
                                          value={categoryForm.tag_name}
                                          onChange={event => handleCategoryFieldChange('tag_name', event.target.value)}
                                          className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        />
                                      </div>
                                      <div>
                                        <label htmlFor="category-parent" className="block text-sm font-medium text-slate-700">
                                          Parent tag (optional)
                                        </label>
                                        <input
                                          id="category-parent"
                                          type="text"
                                          value={categoryForm.parent_tag}
                                          onChange={event => handleCategoryFieldChange('parent_tag', event.target.value)}
                                          className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                          placeholder="e.g., Education"
                                        />
                                      </div>
                                      <div className="md:col-span-2">
                                        <label htmlFor="category-rule" className="block text-sm font-medium text-slate-700">
                                          Tag rule / guidance (optional)
                                        </label>
                                        <textarea
                                          id="category-rule"
                                          value={categoryForm.tag_rule}
                                          onChange={event => handleCategoryFieldChange('tag_rule', event.target.value)}
                                          rows={4}
                                          className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                          placeholder="Explain when this tag should be applied"
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <input
                                          id="category-active"
                                          type="checkbox"
                                          checked={categoryForm.is_active}
                                          onChange={event => handleCategoryFieldChange('is_active', event.target.checked)}
                                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <label htmlFor="category-active" className="text-sm text-slate-600">Active</label>
                                      </div>
                                    </div>

                                    <div className="mt-4 flex flex-wrap gap-3">
                                      <button
                                        type="button"
                                        onClick={handleCategorySave}
                                        disabled={categorySaving}
                                        className={classNames(
                                          'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition',
                                          categorySaving ? 'bg-slate-300 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                        )}
                                      >
                                        {categorySaving ? 'Saving…' : 'Save Category'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={handleCategoryCancel}
                                        disabled={categorySaving}
                                        className={classNames(
                                          'inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition',
                                          categorySaving ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                                        )}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* New category form appears below table when no ID */}
                {categoryForm && !categoryForm.id && (
                  <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                    <h4 className="mb-4 text-sm font-semibold text-slate-700">New Category Tag</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="category-name-new" className="block text-sm font-medium text-slate-700">
                          Tag name
                        </label>
                        <input
                          id="category-name-new"
                          type="text"
                          value={categoryForm.tag_name}
                          onChange={event => handleCategoryFieldChange('tag_name', event.target.value)}
                          className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label htmlFor="category-parent-new" className="block text-sm font-medium text-slate-700">
                          Parent tag (optional)
                        </label>
                        <input
                          id="category-parent-new"
                          type="text"
                          value={categoryForm.parent_tag}
                          onChange={event => handleCategoryFieldChange('parent_tag', event.target.value)}
                          className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="e.g., Education"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label htmlFor="category-rule-new" className="block text-sm font-medium text-slate-700">
                          Tag rule / guidance (optional)
                        </label>
                        <textarea
                          id="category-rule-new"
                          value={categoryForm.tag_rule}
                          onChange={event => handleCategoryFieldChange('tag_rule', event.target.value)}
                          rows={4}
                          className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="Explain when this tag should be applied"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="category-active-new"
                          type="checkbox"
                          checked={categoryForm.is_active}
                          onChange={event => handleCategoryFieldChange('is_active', event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="category-active-new" className="text-sm text-slate-600">Active</label>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleCategorySave}
                        disabled={categorySaving}
                        className={classNames(
                          'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition',
                          categorySaving ? 'bg-slate-300 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        )}
                      >
                        {categorySaving ? 'Saving…' : 'Create Category'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCategoryCancel}
                        disabled={categorySaving}
                        className={classNames(
                          'inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition',
                          categorySaving ? 'border-slate-200 bg-white text-slate-700 cursor-not-allowed' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                        )}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Recent Runs</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review the last 10 automation cycles and drill into step-level results.
                </p>
              </div>
              <button
                type="button"
                onClick={refreshRuns}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Refresh
              </button>
            </div>

            <div className="mt-6 overflow-hidden rounded-lg border border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Run</th>
                    <th className="px-4 py-3 text-left">Started</th>
                    <th className="px-4 py-3 text-left">Duration</th>
                    <th className="px-4 py-3 text-left">Instagram</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Steps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {runs.map(run => {
                    const firstStepStart = stepOrder
                      .map(step => run.step_states?.[step]?.started_at)
                      .find(Boolean);
                    const completedAt = run.completed_at || run.step_states?.[run.current_step ?? '']?.completed_at;
                    const durationSeconds = (() => {
                      if (!firstStepStart || !completedAt) return undefined;
                      try {
                        const start = new Date(firstStepStart).getTime();
                        const end = new Date(completedAt).getTime();
                        return (end - start) / 1000;
                      } catch {
                        return undefined;
                      }
                    })();

                    return (
                      <tr key={run.id} className="align-top">
                        <td className="px-4 py-3 text-slate-700">
                          <div className="font-mono text-xs text-slate-500">{run.id}</div>
                          <div className="text-xs text-slate-500">Triggered by {run.triggered_by}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(run.started_at)}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDuration(durationSeconds)}</td>
                        <td className="px-4 py-3 text-slate-600">{run.include_instagram ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={classNames(
                              'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                              STATUS_COLORS[run.status.toLowerCase()] || 'text-slate-600 bg-slate-100'
                            )}
                          >
                            {run.status.toUpperCase()}
                          </span>
                          {run.error_message && (
                            <p className="mt-1 text-xs text-red-500">{run.error_message}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {stepOrder.map(step => {
                              const state = run.step_states?.[step];
                              const status = state?.status ?? (run.status === 'queued' ? 'pending' : 'pending');
                              const badgeClasses = STATUS_COLORS[status.toLowerCase()] || 'text-slate-600 bg-slate-100';
                              return (
                                <span
                                  key={`${run.id}-${step}`}
                                  className={classNames('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', badgeClasses)}
                                  title={state?.log_tail ? state.log_tail.join('\n') : undefined}
                                >
                                  {getStepLabel(step)}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutomationView;
