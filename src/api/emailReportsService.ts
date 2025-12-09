import type { EmailReportJob, EmailReportJobCreate } from '../types/emailReports';

const API_BASE = '/api/email-reports';

export async function listEmailReportJobs(): Promise<EmailReportJob[]> {
  const response = await fetch(`${API_BASE}/jobs`);
  if (!response.ok) throw new Error('Failed to fetch jobs');
  const data = await response.json();
  return data.jobs || [];
}

export async function createEmailReportJob(job: EmailReportJobCreate): Promise<EmailReportJob> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job)
  });
  if (!response.ok) throw new Error('Failed to create job');
  const data = await response.json();
  return data.job;
}

export async function updateEmailReportJob(id: string, updates: Partial<EmailReportJobCreate>): Promise<EmailReportJob> {
  const response = await fetch(`${API_BASE}/jobs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!response.ok) throw new Error('Failed to update job');
  const data = await response.json();
  return data.job;
}

export async function deleteEmailReportJob(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/jobs/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete job');
}

export async function generateEmailReport(jobId: string): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/generate`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error('Failed to generate report');
  return response.json();
}
