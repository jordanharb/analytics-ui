'use client';

import React, { useState } from 'react';
import type { BulkExportRequest, ExportResult } from './lib/types';
import { APP_CONFIG, ERROR_MESSAGES } from './lib/constants';

const BulkExportPage: React.FC = () => {
  const [entityIds, setEntityIds] = useState('');
  const [exportKind, setExportKind] = useState<'reports' | 'transactions'>('transactions');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function parseEntityIds(input: string): number[] {
    return input
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n) && n > 0);
  }

  function validateForm(): string | null {
    const ids = parseEntityIds(entityIds);

    if (ids.length === 0) {
      return 'Please enter at least one valid entity ID';
    }

    if (ids.length > APP_CONFIG.MAX_ENTITY_IDS) {
      return `Too many entity IDs. Maximum allowed: ${APP_CONFIG.MAX_ENTITY_IDS}`;
    }

    // Validate date range if provided
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return 'From date cannot be after To date';
    }

    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const request: BulkExportRequest = {
        kind: exportKind,
        entity_ids: parseEntityIds(entityIds),
        filters: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        },
      };

      // TODO: Replace with actual API call
      const response = await fetch('/api/legislature/bulk-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || ERROR_MESSAGES.EXPORT_FAILED);
      }

      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : ERROR_MESSAGES.EXPORT_FAILED;
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '0.5rem', color: '#1f2937' }}>
          Bulk Data Export
        </h1>
        <p style={{ fontSize: '1rem', color: '#6b7280', maxWidth: '600px' }}>
          Export campaign finance data in CSV format for multiple entities at once.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        {/* Entity IDs Input */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
            Entity IDs
          </label>
          <textarea
            value={entityIds}
            onChange={(e) => setEntityIds(e.target.value)}
            placeholder="Enter entity IDs separated by commas or spaces (e.g., 123, 456, 789)"
            style={{ width: '100%', padding: '0.5rem', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', minHeight: '100px' }}
            required
          />
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
            Maximum {APP_CONFIG.MAX_ENTITY_IDS} entity IDs allowed
          </p>
        </div>

        {/* Export Type Selection */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
            Data Type
          </label>
          <select
            value={exportKind}
            onChange={(e) => setExportKind(e.target.value as 'reports' | 'transactions')}
            style={{ width: '100%', padding: '0.5rem', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', backgroundColor: 'white' }}
          >
            <option value="transactions">Transactions</option>
            <option value="reports">Reports</option>
          </select>
        </div>

        {/* Date Range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
              From Date (Optional)
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '0.375rem' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
              To Date (Optional)
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '0.375rem' }}
            />
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: '600', color: 'white', backgroundColor: loading ? '#9ca3af' : '#0066cc', border: 'none', borderRadius: '0.5rem', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Generating Export...' : 'Generate Export'}
        </button>
      </form>

      {/* Error Message */}
      {error && (
        <div style={{ padding: '1rem', backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#991b1b', marginBottom: '1rem', maxWidth: '600px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Success Result */}
      {result && (
        <div style={{ padding: '1.5rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', maxWidth: '600px' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#166534', marginBottom: '1rem' }}>
            Export Ready
          </h2>
          <div style={{ fontSize: '0.875rem', color: '#374151' }}>
            <p style={{ marginBottom: '0.5rem' }}>
              <strong>Records:</strong> {result.record_count?.toLocaleString() || 0}
            </p>
            <p style={{ marginBottom: '0.5rem' }}>
              <strong>Entities:</strong> {result.entity_count}
            </p>
            <p style={{ marginBottom: '0.5rem' }}>
              <strong>File Size:</strong> {Math.round(result.size_bytes / 1024).toLocaleString()} KB
            </p>
          </div>
          <a
            href={result.url}
            download={result.filename}
            style={{ display: 'inline-block', marginTop: '1rem', padding: '0.5rem 1.5rem', fontSize: '0.875rem', fontWeight: '500', color: 'white', backgroundColor: '#059669', borderRadius: '0.375rem', textDecoration: 'none' }}
          >
            Download CSV
          </a>
        </div>
      )}
    </div>
  );
};

export default BulkExportPage;