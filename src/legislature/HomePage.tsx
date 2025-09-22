'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PersonSearchResult } from './lib/types';
import { APP_CONFIG } from './lib/constants';
import { searchPeopleWithSessions } from './lib/search';
import { testDatabaseConnection } from '../lib/test-db-connection';

const HomePage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q');

  console.log('HomePage rendering, queryParam:', queryParam, 'results:', results.length);

  // Temporary debug: test database connection
  useEffect(() => {
    testDatabaseConnection();
  }, []);

  useEffect(() => {
    if (queryParam && queryParam.trim().length > 0) {
      setSearchQuery(queryParam);
      void searchEntities(queryParam);
      return;
    }

    setSearchQuery('');
    setResults([]);
  }, [queryParam]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchQuery.trim().length > 0) {
        setSearchParams({ q: searchQuery });
      } else {
        setSearchParams({});
      }
    }, 300); // 300ms debounce delay

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery, setSearchParams]);

  const searchEntities = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const people = await searchPeopleWithSessions({
        query: trimmed,
        limit: APP_CONFIG.DEFAULT_SEARCH_LIMIT,
      });
      setResults(people);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    if (!amount || amount === 0) return '$0';
    return `${Math.round(amount).toLocaleString()}`;
  };

  const formatDate = (dateString: string | null | undefined): string => {
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
      <form style={{ marginBottom: '2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
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
            {results.map((result) => {
              const personUrl = `/legislature/person/${result.person_id}`;
              const summary = result.summary ?? `${result.legislator_count} legislators • ${result.entity_count} entities`;
              const civicLine = [
                result.party,
                result.body ? `${result.body}${result.district ? ` District ${result.district}` : ''}` : null,
                result.latest_activity ? `Last Active: ${formatDate(result.latest_activity)}` : null,
              ].filter(Boolean).join(' • ');

              return (
                <div
                  key={result.person_id}
                  style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                        <a
                          href={personUrl}
                          style={{ color: '#0066cc', textDecoration: 'none' }}
                        >
                          {result.display_name}
                        </a>
                      </h3>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: '#6b7280', fontSize: '0.875rem' }}>
                        {civicLine && <span>{civicLine}</span>}
                        <span>{summary}</span>
                        {result.primary_entity_name && (
                          <span>Primary committee: {result.primary_entity_name}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '2rem', textAlign: 'right' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Raised</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600', color: '#059669' }}>
                          {formatCurrency(result.total_income)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Spent</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: '600', color: '#dc2626' }}>
                          {formatCurrency(result.total_expense)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
