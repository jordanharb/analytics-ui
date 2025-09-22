'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PersonProfile, PersonVote } from '../lib/legislature-types';
import type { PersonSession, PersonFinanceOverview } from '../lib/legislature-people-types';
import { fetchPersonOverview, fetchPersonVotes } from '../lib/legislature-api';
import { fetchPersonSessions, fetchPersonFinanceOverview, fetchPersonVotesInSession } from '../lib/legislature-people-api';
import type { PersonSearchResult as SearchSummary } from './lib/types';
import { searchPeopleWithSessions } from './lib/search';
import EntityDetailView from '../components/finance/EntityDetailView';

const formatCurrency = (amount: number | null | undefined): string => {
  if (!amount || Number.isNaN(amount)) return '$0';
  const absAmount = Math.abs(amount);
  const formatted = absAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `$${formatted}`;
};

const formatDate = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
};

const metricStyle: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '0.75rem',
  padding: '1rem 1.25rem',
  flex: '1',
  minWidth: '180px',
};

const PersonPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);

  const [overview, setOverview] = useState<PersonProfile | null>(null);
  const [finance, setFinance] = useState<PersonFinanceOverview | null>(null);
  const [sessions, setSessions] = useState<PersonSession[]>([]);
  const [recentVotes, setRecentVotes] = useState<PersonVote[]>([]);
  const [searchSummary, setSearchSummary] = useState<SearchSummary | null>(null);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [sessionVotes, setSessionVotes] = useState<PersonVote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(personId) || personId <= 0) {
      setError('Invalid person identifier.');
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [overviewData, sessionsData, financeData] = await Promise.all([
          fetchPersonOverview(personId),
          fetchPersonSessions(personId),
          fetchPersonFinanceOverview(personId),
        ]);

        if (cancelled) return;

        console.log('overviewData', overviewData);

        setOverview(overviewData ?? null);
        console.log('sessionsData', sessionsData);

        setSessions(sessionsData ?? []);
        console.log('financeData', financeData);

        setFinance(financeData ?? null);

        const displayName = overviewData?.full_name || financeData?.entity_details?.[0]?.display_name;
        if (displayName) {
          const matches = await searchPeopleWithSessions({ query: displayName, limit: 10 });
          if (!cancelled) {
            const match = matches.find((m) => m.person_id === personId) ?? matches[0] ?? null;
            console.log('searchSummary', match);
            setSearchSummary(match ?? null);
          }
        }

        const voteResponse = await fetchPersonVotes(personId, undefined, { limit: 5, offset: 0 });
        console.log('recentVotes', voteResponse.data);
        if (!cancelled) {
          setRecentVotes(voteResponse.data ?? []);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load person data', err);
          setError(err?.message ?? 'Failed to load person data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [personId]);

  const toggleSession = async (sessionId: number) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      setSessionVotes([]);
    } else {
      setExpandedSession(sessionId);
      const votes = await fetchPersonVotesInSession(personId, sessionId);
      setSessionVotes(votes || []);
    }
  };

  const entityDetails = finance?.entity_details ?? [];
  const headerName = searchSummary?.display_name || overview?.full_name || 'Unknown Person';
  const civicLine = useMemo(() => {
    const parts: string[] = [];
    if (searchSummary?.party) parts.push(searchSummary.party);
    if (searchSummary?.body) {
      const district = searchSummary.district ? ` District ${searchSummary.district}` : '';
      parts.push(`${searchSummary.body}${district}`.trim());
    }
    if (finance?.first_activity || finance?.last_activity) {
      parts.push(
        `Activity: ${formatDate(finance?.first_activity)} → ${formatDate(finance?.last_activity)}`,
      );
    }
    return parts.join(' • ');
  }, [finance?.first_activity, finance?.last_activity, searchSummary?.body, searchSummary?.district, searchSummary?.party]);

  if (!Number.isFinite(personId) || personId <= 0) {
    return (
      <div style={{ padding: '2rem', color: '#6b7280' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>
          Invalid person
        </h2>
        <p>Please return to search and choose a valid person.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <header>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 700, marginBottom: '0.5rem', color: '#1f2937' }}>
          {headerName}
        </h1>
        {civicLine && <p style={{ color: '#6b7280', fontSize: '1rem' }}>{civicLine}</p>}
      </header>

      {error && (
        <div style={{ padding: '1rem', border: '1px solid #fca5a5', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '0.5rem' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ color: '#6b7280' }}>Loading person data…</div>
      )}

      {!loading && !error && (
        <>
          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
              Overview
            </h2>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#6b7280' }}>Total Raised</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669' }}>
                  {formatCurrency(finance?.total_raised)}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#6b7280' }}>Total Spent</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                  {formatCurrency(finance?.total_spent)}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#6b7280' }}>Entities</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f2937' }}>
                  {finance?.entity_count ?? 0}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#6b7280' }}>Votes Recorded</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f2937' }}>
                  {overview?.total_votes ?? 0}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#6b7280' }}>Bills Sponsored</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f2937' }}>
                  {overview?.total_bills_sponsored ?? 0}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
              Legislative Sessions
            </h2>
            {sessions.length === 0 ? (
              <div style={{ padding: '1.5rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', color: '#6b7280' }}>
                No session activity recorded for this person yet.
              </div>
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead style={{ backgroundColor: '#f9fafb' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Session</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Year</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Votes</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Bills Sponsored</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <React.Fragment key={session.session_id}>
                        <tr onClick={() => toggleSession(session.session_id)} style={{ cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '0.75rem 1rem', color: '#1f2937' }}>{session.session_name}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#1f2937' }}>{session.year}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#1f2937' }}>{session.vote_count}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#1f2937' }}>{session.sponsored_count}</td>
                        </tr>
                        {expandedSession === session.session_id && (
                          <tr>
                            <td colSpan={4} style={{ padding: '1rem' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead style={{ backgroundColor: '#f9fafb' }}>
                                  <tr>
                                    <th style={{ textAlign: 'left', padding: '0.5rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Bill</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Vote</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem 1rem', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sessionVotes.map((vote) => (
                                    <tr key={vote.vote_id}>
                                      <td style={{ padding: '0.5rem 1rem' }}>{vote.bill_number}</td>
                                      <td style={{ padding: '0.5rem 1rem' }}>{vote.vote_value}</td>
                                      <td style={{ padding: '0.5rem 1rem' }}>{formatDate(vote.vote_date)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {recentVotes.length > 0 && (
            <section>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
                Recent Votes
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {recentVotes.map((vote) => (
                  <div
                    key={`${vote.vote_id}-${vote.bill_id}`}
                    style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem 1rem' }}
                  >
                    <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '0.25rem' }}>
                      {vote.bill_number}: {vote.bill_title}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                      {formatDate(vote.vote_date)} • {vote.session_name} • Voted {vote.vote_value}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
              Campaign Finance Entities
            </h2>

            {entityDetails.length === 0 ? (
              <div style={{ padding: '1.5rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', color: '#6b7280' }}>
                No linked campaign finance entities found for this person.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {entityDetails.map((entity) => (
                  <div
                    key={entity.entity_id}
                    style={{ border: '1px solid #e5e7eb', borderRadius: '0.75rem', backgroundColor: '#ffffff', padding: '1rem 1.25rem' }}
                  >
                    <a
                      href={`/legislature/finance/entity/${entity.entity_id}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.35rem' }}>
                        {entity.display_name || `Entity ${entity.entity_id}`}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: '0.875rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span>Raised {formatCurrency(entity.total_raised)}</span>
                        <span>Spent {formatCurrency(entity.total_spent)}</span>
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default PersonPage;

