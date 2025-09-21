'use client';

import { useState } from 'react';
import { BulkExportRequest, ExportJob, ExportResult } from '@/lib/types';
import { APP_CONFIG, ERROR_MESSAGES } from '@/lib/constants';

export default function BulkExportPage() {
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

      const response = await fetch('/api/bulk-export', {
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
      console.error('Export error:', err);
      setError(err instanceof Error ? err.message : ERROR_MESSAGES.EXPORT_FAILED);
    } finally {
      setLoading(false);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleReset() {
    setEntityIds('');
    setExportKind('transactions');
    setDateFrom('');
    setDateTo('');
    setResult(null);
    setError(null);
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          marginBottom: '0.5rem',
          color: '#1f2937',
        }}>
          Bulk Export
        </h1>
        <p style={{
          fontSize: '1rem',
          color: '#6b7280',
          marginBottom: '0',
          maxWidth: '600px',
        }}>
          Export data for multiple entities at once. The system will generate a CSV file and provide a download link.
        </p>
      </div>

      <div style={{
        maxWidth: '700px',
        backgroundColor: '#f9fafb',
        padding: '2rem',
        borderRadius: '0.5rem',
        border: '1px solid #e5e7eb',
      }}>
        <form onSubmit={handleSubmit}>
          {/* Entity IDs Input */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label 
              htmlFor="entityIds"
              style={{
                display: 'block',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '0.5rem',
              }}
            >
              Entity IDs <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              id="entityIds"
              value={entityIds}
              onChange={(e) => setEntityIds(e.target.value)}
              placeholder="Enter entity IDs separated by commas or spaces (e.g., 100001, 100002, 100003)"
              rows={4}
              style={{
                width: '100%',
                padding: '0.75rem',
                fontSize: '0.9rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                outline: 'none',
                resize: 'vertical',
              }}
            />
            <div style={{
              fontSize: '0.8rem',
              color: '#6b7280',
              marginTop: '0.25rem',
            }}>
              Maximum {APP_CONFIG.MAX_ENTITY_IDS} entity IDs per export
            </div>
          </div>

          {/* Export Type */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label 
              htmlFor="exportKind"
              style={{
                display: 'block',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '0.5rem',
              }}
            >
              Export Type
            </label>
            <select
              id="exportKind"
              value={exportKind}
              onChange={(e) => setExportKind(e.target.value as 'reports' | 'transactions')}
              style={{
                width: '100%',
                padding: '0.75rem',
                fontSize: '0.9rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                outline: 'none',
                backgroundColor: 'white',
                cursor: 'pointer',
              }}
            >
              <option value="transactions">Transactions</option>
              <option value="reports">Reports</option>
            </select>
          </div>

          {/* Date Range (Optional) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}>
            <div>
              <label 
                htmlFor="dateFrom"
                style={{
                  display: 'block',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '0.5rem',
                }}
              >
                From Date (Optional)
              </label>
              <input
                type="date"
                id="dateFrom"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.9rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  outline: 'none',
                }}
              />
            </div>
            <div>
              <label 
                htmlFor="dateTo"
                style={{
                  display: 'block',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '0.5rem',
                }}
              >
                To Date (Optional)
              </label>
              <input
                type="date"
                id="dateTo"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.9rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Submit Button */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            marginTop: '2rem',
          }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.75rem 2rem',
                fontSize: '1rem',
                fontWeight: '600',
                color: 'white',
                backgroundColor: loading ? '#9ca3af' : '#0066cc',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    display: 'inline-block',
                    width: '1rem',
                    height: '1rem',
                    border: '2px solid #e5e7eb',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite',
                  }} />
                  Processing...
                </>
              ) : (
                <>📥 Generate Export</>
              )}
            </button>
            
            {(result || error) && (
              <button
                type="button"
                onClick={handleReset}
                style={{
                  padding: '0.75rem 1.5rem',
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: '#4b5563',
                  backgroundColor: 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease',
                }}
              >
                Reset Form
              </button>
            )}
          </div>
        </form>

        {/* Error Message */}
        {error && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            backgroundColor: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '0.375rem',
            color: '#991b1b',
            fontSize: '0.9rem',
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Success Result */}
        {result && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1.5rem',
            backgroundColor: '#dcfce7',
            border: '1px solid #86efac',
            borderRadius: '0.375rem',
          }}>
            <h3 style={{
              fontSize: '1.1rem',
              fontWeight: '600',
              color: '#166534',
              marginBottom: '1rem',
            }}>
              ✅ Export Complete!
            </h3>
            
            <div style={{
              display: 'grid',
              gap: '0.75rem',
              fontSize: '0.9rem',
              color: '#166534',
              marginBottom: '1rem',
            }}>
              <div>
                <strong>File Name:</strong> {result.filename}
              </div>
              <div>
                <strong>Size:</strong> {formatFileSize(result.size_bytes)}
              </div>
              <div>
                <strong>Rows:</strong> {result.record_count.toLocaleString()}
              </div>
              <div>
                <strong>Entities:</strong> {result.entity_count}
              </div>
              {result.cached && (
                <div style={{ fontStyle: 'italic' }}>
                  (Retrieved from cache)
                </div>
              )}
            </div>

            <a
              href={result.url}
              download
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                fontSize: '1rem',
                fontWeight: '600',
                color: 'white',
                backgroundColor: '#16a34a',
                textDecoration: 'none',
                borderRadius: '0.375rem',
                transition: 'background-color 0.2s ease',
              }}
            >
              💾 Download CSV
            </a>
          </div>
        )}
      </div>

      {/* Help Section */}
      <div style={{
        marginTop: '3rem',
        maxWidth: '700px',
        padding: '1.5rem',
        backgroundColor: '#f0f9ff',
        border: '1px solid #e0f2fe',
        borderRadius: '0.5rem',
      }}>
        <h3 style={{
          fontSize: '1.1rem',
          fontWeight: '600',
          color: '#0c4a6e',
          marginBottom: '1rem',
        }}>
          How to Use Bulk Export
        </h3>
        <ol style={{
          color: '#155e75',
          fontSize: '0.9rem',
          paddingLeft: '1.5rem',
          lineHeight: '1.8',
        }}>
          <li>Enter entity IDs separated by commas or spaces</li>
          <li>Select whether you want to export Reports or Transactions</li>
          <li>Optionally specify a date range to filter the data</li>
          <li>Click Generate Export to create your CSV file</li>
          <li>Download the file when ready</li>
        </ol>
        
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          backgroundColor: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: '0.375rem',
          fontSize: '0.85rem',
          color: '#92400e',
        }}>
          <strong>Note:</strong> Exports are cached for 15 minutes. If you request the same data within that time, 
          you'll receive the cached version instantly.
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}