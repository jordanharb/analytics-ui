'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { SearchResult } from './lib/types';
import { APP_CONFIG } from './lib/constants';

const HomePage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryParam = searchParams.get('q');

  console.log('HomePage rendering, queryParam:', queryParam, 'results:', results.length);

  useEffect(() => {
    if (queryParam) {
      setSearchQuery(queryParam);
      searchEntities(queryParam);
    }
  }, [queryParam]);

  const searchEntities = async (query: string) => {
    if (!query || query.trim().length === 0) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      // Call Supabase directly with service role key
      // TODO: Switch to API endpoint when deployed to Vercel
      const SUPABASE_URL = import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL || import.meta.env.VITE_SUPABASE2_URL;
      const SERVICE_ROLE_KEY = import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY || import.meta.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY;

      if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        console.error('Missing Supabase credentials');
        setResults([]);
        setLoading(false);
        return;
      }

      const url = `${SUPABASE_URL}/rest/v1/rpc/search_entities`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          q: query.trim(),
          lim: APP_CONFIG.DEFAULT_SEARCH_LIMIT,
          off: APP_CONFIG.DEFAULT_OFFSET
        })
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      console.log('Search response:', data);

      setResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/legislature?q=${encodeURIComponent(searchQuery)}`);
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    if (!amount || amount === 0) return '$0';
    return `$${Math.round(amount).toLocaleString()}`;
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return '—';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '0.5rem', color: '#1f2937' }}>
          Search Campaign Finance Data
        </h1>
        <p style={{ fontSize: '1rem', color: '#6b7280', marginBottom: '1.5rem', maxWidth: '600px' }}>
          Search for candidates, committees, and PACs to view their campaign finance reports and transactions.
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '300px' }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by candidate name, committee name, or keyword..."
            style={{ width: '100%', padding: '0.75rem 1rem', fontSize: '1rem', border: '2px solid #d1d5db', borderRadius: '0.5rem', outline: 'none' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: '600', color: 'white', backgroundColor: loading ? '#9ca3af' : '#0066cc', border: 'none', borderRadius: '0.5rem', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Results Section */}
      {results.length > 0 && (
        <div>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
            Found {results.length} result{results.length === 1 ? '' : 's'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {results.map((result) => (
              <div
                key={result.entity_id}
                style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      <a
                        href={`/legislature/candidate/${result.entity_id}`}
                        style={{ color: '#0066cc', textDecoration: 'none' }}
                      >
                        {result.name}
                      </a>
                    </h3>

                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                      {result.party_name && <span>{result.party_name}</span>}
                      {result.office_name && <span>{result.office_name}</span>}
                      {result.latest_activity && (
                        <span>Last Active: {formatDate(result.latest_activity)}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '2rem', textAlign: 'right' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Income</div>
                      <div style={{ fontSize: '1.125rem', fontWeight: '600', color: '#059669' }}>
                        {formatCurrency(result.total_income)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Expense</div>
                      <div style={{ fontSize: '1.125rem', fontWeight: '600', color: '#dc2626' }}>
                        {formatCurrency(result.total_expense)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {!loading && queryParam && results.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', color: '#6b7280' }}>
          <p style={{ fontSize: '1.125rem' }}>No results found for "{queryParam}"</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>Try searching with different keywords or check the spelling</p>
        </div>
      )}

      {/* Initial State */}
      {!queryParam && (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', color: '#6b7280' }}>
          <p style={{ fontSize: '1.125rem' }}>Enter a search term to find campaign finance data</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>You can search by candidate name, committee name, or PAC name</p>
        </div>
      )}
    </div>
  );
};

export default HomePage;