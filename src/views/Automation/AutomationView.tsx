import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
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
  getStepLabel
} from '../../api/automationService';
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
  } catch (err) {
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
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggeringRun, setTriggeringRun] = useState(false);

  // const hasActiveRun = useMemo(() => runs.some(run => run.status === 'running'), [runs]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const { settings: config, recentRuns } = await fetchAutomationConfig();
      setSettings(config);
      setRuns(recentRuns ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load automation status');
    } finally {
      setLoading(false);
    }
  }, []);

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
    loadData();
  }, true);

  const handleUpdateSettings = useCallback(async (updates: Partial<AutomationSettings>) => {
    setSaving(true);
    try {
      const updated = await updateAutomationConfig(updates);
      setSettings(updated);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  }, []);

  const handleToggleEnabled = useCallback(() => {
    if (!settings) return;
    handleUpdateSettings({ is_enabled: !settings.is_enabled });
  }, [handleUpdateSettings, settings]);

  const handleToggleInstagram = useCallback(() => {
    if (!settings) return;
    handleUpdateSettings({ include_instagram: !settings.include_instagram });
  }, [handleUpdateSettings, settings]);

  const handleIntervalChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    if (Number.isFinite(value) && value > 0) {
      handleUpdateSettings({ run_interval_hours: value });
    }
  }, [handleUpdateSettings]);

  const handleRunNow = useCallback(async () => {
    setTriggeringRun(true);
    try {
      const run = await triggerAutomationRun();
      setRuns(prev => [run, ...prev]);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to start automation run');
    } finally {
      setTriggeringRun(false);
    }
  }, []);

  const stepOrder = useMemo(() => getStepOrder(), []);

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
          {settings && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Schedule</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Control automatic execution cadence and Instagram inclusion.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center">
                    <span className="mr-3 text-sm font-medium text-slate-600">Automation</span>
                    <input
                      type="checkbox"
                      className="h-4 w-10 rounded-full bg-slate-200"
                      checked={settings.is_enabled}
                      onChange={handleToggleEnabled}
                      disabled={saving}
                    />
                  </label>
                </div>

                <dl className="mt-6 space-y-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-slate-700">Run interval</dt>
                    <input
                      type="number"
                      min={6}
                      step={1}
                      value={settings.run_interval_hours}
                      onChange={handleIntervalChange}
                      className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={saving}
                    />
                    <span className="ml-2 text-slate-500">hours</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-slate-700">Include Instagram scraping</dt>
                    <input
                      type="checkbox"
                      checked={settings.include_instagram}
                      onChange={handleToggleInstagram}
                      disabled={saving}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Last run</dt>
                      <dd className="mt-1 text-sm text-slate-700">{formatDate(settings.last_run_started_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Last completed</dt>
                      <dd className="mt-1 text-sm text-slate-700">{formatDate(settings.last_run_completed_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Next scheduled</dt>
                      <dd className="mt-1 text-sm text-slate-700">{formatDate(settings.next_run_at)}</dd>
                    </div>
                  </div>
                </dl>
              </div>

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
            </div>
          )}

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
                      } catch (err) {
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
