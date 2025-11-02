import React, { useEffect, useState } from 'react';
import { EmailReportJobForm } from '../../components/EmailReportJobForm';
import type { EmailReportJobCreate } from '../../types/emailReports';

interface EmailReportJob {
  id: string;
  name: string;
  description?: string;
  is_enabled: boolean;
  period_type: 'last_n_days' | 'last_week' | 'last_month' | 'custom_range';
  period_days?: number;
  recipient_emails: string[];
  schedule_type: 'manual' | 'daily' | 'weekly' | 'monthly';
  schedule_time: string;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
}

export const EmailReportsView: React.FC = () => {
  const [jobs, setJobs] = useState<EmailReportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    fetchJobs();
  }, []);

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

  const handleCreateJob = async (job: EmailReportJobCreate) => {
    try {
      const response = await fetch('/api/email-reports/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create job');
      }

      setShowCreateForm(false);
      await fetchJobs();
      alert('Report job created successfully!');
    } catch (err) {
      throw err; // Let the form handle the error display
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
        return `Last ${job.period_days || 7} days`;
      case 'last_week':
        return 'Last week';
      case 'last_month':
        return 'Last month';
      case 'custom_range':
        return 'Custom range';
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
            onClick={() => setShowCreateForm(true)}
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
          {jobs.map((job) => (
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
                </div>

                <div className="flex flex-col gap-2 ml-6">
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
          ))}
        </div>
      )}

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-8 my-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Create Email Report Job</h2>

            <EmailReportJobForm
              onSubmit={handleCreateJob}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
