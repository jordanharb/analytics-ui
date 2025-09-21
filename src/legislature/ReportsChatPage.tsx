'use client';

import React, { useState } from 'react';

const ReportsChatPage: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [entityIds, setEntityIds] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setReport('');

    try {
      const response = await fetch('/api/legislature/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          entity_ids: entityIds.split(',').map(id => id.trim()).filter(Boolean),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate report');
      }

      const data = await response.json();
      setReport(data.report || 'Report generated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '0.5rem', color: '#1f2937' }}>
          AI-Powered Campaign Finance Reports
        </h1>
        <p style={{ fontSize: '1rem', color: '#6b7280', maxWidth: '600px' }}>
          Generate intelligent analysis and reports using AI to understand campaign finance patterns and trends.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Input Form */}
        <div>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
                What would you like to know?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="E.g., Analyze the funding sources for the top 5 candidates in the 2024 gubernatorial race"
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', minHeight: '120px' }}
                required
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
                Entity IDs (Optional)
              </label>
              <input
                type="text"
                value={entityIds}
                onChange={(e) => setEntityIds(e.target.value)}
                placeholder="Enter specific entity IDs separated by commas"
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '0.375rem' }}
              />
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                Leave empty to analyze all available data
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: '600', color: 'white', backgroundColor: loading ? '#9ca3af' : '#0066cc', border: 'none', borderRadius: '0.5rem', cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Generating Report...' : 'Generate Report'}
            </button>
          </form>

          {/* Example Prompts */}
          <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.75rem' }}>
              Example Prompts
            </h3>
            <ul style={{ fontSize: '0.75rem', color: '#6b7280', listStyle: 'none', padding: 0 }}>
              <li style={{ marginBottom: '0.5rem' }}>• Who are the top donors across all campaigns?</li>
              <li style={{ marginBottom: '0.5rem' }}>• Compare spending patterns between Republican and Democratic candidates</li>
              <li style={{ marginBottom: '0.5rem' }}>• Analyze PAC contributions in the last election cycle</li>
              <li style={{ marginBottom: '0.5rem' }}>• Show me trends in small-dollar donations</li>
              <li>• Which industries are the biggest campaign contributors?</li>
            </ul>
          </div>
        </div>

        {/* Report Output */}
        <div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem', minHeight: '400px', backgroundColor: '#ffffff' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#374151', marginBottom: '1rem' }}>
              Generated Report
            </h3>

            {error && (
              <div style={{ padding: '1rem', backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#991b1b', marginBottom: '1rem' }}>
                Error: {error}
              </div>
            )}

            {loading && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                <p>Analyzing data and generating report...</p>
                <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>This may take a moment</p>
              </div>
            )}

            {report && !loading && (
              <div style={{ fontSize: '0.875rem', lineHeight: '1.6', color: '#374151', whiteSpace: 'pre-wrap' }}>
                {report}
              </div>
            )}

            {!report && !loading && !error && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                <p>Your report will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportsChatPage;