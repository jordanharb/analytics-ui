'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PersonProfile, PersonDonation } from '../lib/legislature-types';
import type {
  PersonSession,
  PersonFinanceOverview,
  PersonBillVote,
  GroupedRollCall,
  TopDonor,
  BillDetails
} from '../lib/legislature-people-types';
import { fetchPersonOverview, fetchPersonVotes, fetchEntityDonations } from '../lib/legislature-api';
import {
  fetchPersonSessions,
  fetchPersonFinanceOverview,
  fetchPersonSessionBillVotes,
  fetchBillRollCall,
  fetchBillDetails,
  fetchEntityTopDonors
} from '../lib/legislature-people-api';
import type { PersonSearchResult as SearchSummary } from './lib/types';
import { searchPeopleWithSessions } from './lib/search';
// import EntityDetailView from '../components/finance/EntityDetailView';

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

const SESSION_PAGE_SIZE = 10;
const DONATION_PAGE_SIZE = 25;
const TOP_DONOR_PAGE_SIZE = 10;
const TOP_DONOR_FETCH_LIMIT = 200;

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.5rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid',
  borderColor: active ? '#2563eb' : '#d1d5db',
  color: active ? '#1f2937' : '#4b5563',
  backgroundColor: active ? 'rgba(37, 99, 235, 0.1)' : '#ffffff',
  cursor: 'pointer',
  fontWeight: active ? 600 : 500,
  fontSize: '0.9rem',
});

const formatDateRange = (start?: string | null, end?: string | null): string => {
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);

  if (startLabel === '—' && endLabel === '—') return 'Dates unavailable';
  if (startLabel !== '—' && endLabel !== '—') return `${startLabel} → ${endLabel}`;
  return startLabel !== '—' ? `From ${startLabel}` : `Through ${endLabel}`;
};

type SessionVoteSnapshot = {
  items: PersonBillVote[];
  page: number;
  hasMore: boolean;
  loading: boolean;
};

type TopDonorSnapshot = {
  donors: TopDonor[];
  fetchedLimit: number;
  hasMore: boolean;
};

const PersonPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);

  const [overview, setOverview] = useState<PersonProfile | null>(null);
  const [finance, setFinance] = useState<PersonFinanceOverview | null>(null);
  const [sessions, setSessions] = useState<PersonSession[]>([]);
  const [recentVotes, setRecentVotes] = useState<any[]>([]);
  const [searchSummary, setSearchSummary] = useState<SearchSummary | null>(null);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [sessionVoteState, setSessionVoteState] = useState<Record<number, SessionVoteSnapshot>>({});
  const [sessionVoteErrors, setSessionVoteErrors] = useState<Record<number, string | null>>({});
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());
  const [billDetailMap, setBillDetailMap] = useState<Map<number, BillDetails | null>>(new Map());
  const [billRollCallMap, setBillRollCallMap] = useState<Map<number, GroupedRollCall[]>>(new Map());
  const [billLoading, setBillLoading] = useState<Set<number>>(new Set());
  const [billErrors, setBillErrors] = useState<Map<number, string>>(new Map());
  const [financeTab, setFinanceTab] = useState<'entities' | 'donations' | 'topDonors'>('entities');
  const [donations, setDonations] = useState<PersonDonation[]>([]);
  const [donationsPage, setDonationsPage] = useState(0);
  const [donationsHasMore, setDonationsHasMore] = useState(false);
  const [donationsLoading, setDonationsLoading] = useState(false);
  const [donationsError, setDonationsError] = useState<string | null>(null);
  const [topDonorEntityId, setTopDonorEntityId] = useState<number | null>(null);
  const [topDonorState, setTopDonorState] = useState<Record<number, TopDonorSnapshot>>({});
  const [topDonorPage, setTopDonorPage] = useState(0);
  const [topDonorsLoading, setTopDonorsLoading] = useState(false);
  const [topDonorError, setTopDonorError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const donationCacheRef = useRef<{ donations: PersonDonation[]; fetchedLimit: number; hasMore: boolean }>({
    donations: [],
    fetchedLimit: 0,
    hasMore: false,
  });

  const loadSessionVotes = useCallback(async (sessionId: number, page: number = 0) => {
    if (!Number.isFinite(personId) || personId <= 0) return;
    setSessionVoteState(prev => {
      const snapshot = prev[sessionId];
      return {
        ...prev,
        [sessionId]: {
          items: snapshot?.items ?? [],
          page: snapshot?.page ?? 0,
          hasMore: snapshot?.hasMore ?? false,
          loading: true,
        },
      };
    });
    setSessionVoteErrors(prev => ({ ...prev, [sessionId]: null }));
    try {
      const { data, hasMore } = await fetchPersonSessionBillVotes(
        personId,
        sessionId,
        SESSION_PAGE_SIZE,
        page * SESSION_PAGE_SIZE
      );
      setSessionVoteState(prev => ({
        ...prev,
        [sessionId]: {
          items: data || [],
          page,
          hasMore,
          loading: false,
        },
      }));
    } catch (err) {
      setSessionVoteErrors(prev => ({
        ...prev,
        [sessionId]: err instanceof Error ? err.message : 'Failed to load session votes.',
      }));
      setSessionVoteState(prev => {
        const snapshot = prev[sessionId];
        return {
          ...prev,
          [sessionId]: {
            items: snapshot?.items ?? [],
            page: snapshot?.page ?? 0,
            hasMore: snapshot?.hasMore ?? false,
            loading: false,
          },
        };
      });
    }
  }, [personId]);

  const handleSessionToggle = useCallback(async (sessionId: number) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      setExpandedBills(new Set());
      return;
    }
    setExpandedSession(sessionId);
    setExpandedBills(new Set());
    const snapshot = sessionVoteState[sessionId];
    if (!snapshot || snapshot.items.length === 0) {
      await loadSessionVotes(sessionId, 0);
    }
  }, [expandedSession, sessionVoteState, loadSessionVotes]);

  const handleSessionPageChange = useCallback(async (sessionId: number, direction: 'next' | 'prev') => {
    const snapshot = sessionVoteState[sessionId];
    if (!snapshot || snapshot.loading) return;
    if (direction === 'prev') {
      if (snapshot.page === 0) return;
      await loadSessionVotes(sessionId, snapshot.page - 1);
      return;
    }
    if (!snapshot.hasMore) return;
    await loadSessionVotes(sessionId, snapshot.page + 1);
  }, [sessionVoteState, loadSessionVotes]);

  const loadBillInfo = useCallback(async (billId: number) => {
    if (!Number.isFinite(billId) || billId <= 0) return;
    setBillErrors(prev => {
      const next = new Map(prev);
      next.delete(billId);
      return next;
    });
    setBillLoading(prev => {
      const next = new Set(prev);
      next.add(billId);
      return next;
    });
    try {
      const [details, rollCall] = await Promise.all([
        fetchBillDetails(billId),
        fetchBillRollCall(billId),
      ]);
      setBillDetailMap(prev => {
        const next = new Map(prev);
        next.set(billId, details);
        return next;
      });
      setBillRollCallMap(prev => {
        const next = new Map(prev);
        next.set(billId, rollCall);
        return next;
      });
    } catch (err) {
      setBillErrors(prev => {
        const next = new Map(prev);
        next.set(billId, err instanceof Error ? err.message : 'Failed to load bill details.');
        return next;
      });
    } finally {
      setBillLoading(prev => {
        const next = new Set(prev);
        next.delete(billId);
        return next;
      });
    }
  }, []);

  const handleBillToggle = useCallback(async (billId: number) => {
    const isExpanded = expandedBills.has(billId);
    setExpandedBills(prev => {
      const next = new Set(prev);
      if (isExpanded) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
    if (!isExpanded && !billDetailMap.has(billId) && !billLoading.has(billId)) {
      await loadBillInfo(billId);
    }
  }, [expandedBills, billDetailMap, billLoading, loadBillInfo]);

  const loadDonations = useCallback(async (page: number = 0) => {
    if (!Number.isFinite(personId) || personId <= 0) return;
    const entityDetails = finance?.entity_details ?? [];
    const entityIds = entityDetails.map(detail => detail.entity_id).filter((value): value is number => Number.isFinite(value));

    if (entityIds.length === 0) {
      donationCacheRef.current = { donations: [], fetchedLimit: 0, hasMore: false };
      setDonations([]);
      setDonationsPage(0);
      setDonationsHasMore(false);
      return;
    }

    const required = (page + 1) * DONATION_PAGE_SIZE;
    const cache = donationCacheRef.current;

    // Check if we have enough cached data to satisfy this page request
    if (cache.donations.length >= required) {
      const slice = cache.donations.slice(page * DONATION_PAGE_SIZE, (page + 1) * DONATION_PAGE_SIZE);
      setDonations(slice);
      setDonationsPage(page);
      setDonationsHasMore(cache.hasMore || cache.donations.length > (page + 1) * DONATION_PAGE_SIZE);
      return;
    }

    // Need to fetch more data
    setDonationsLoading(true);
    setDonationsError(null);
    try {
      // Calculate how much to fetch per entity
      // We want to fetch enough to cover the requested page plus a buffer for future pages
      const totalNeeded = required + DONATION_PAGE_SIZE * 2;
      const perEntityLimit = Math.ceil(totalNeeded / entityIds.length);
      const fetchLimit = Math.min(perEntityLimit, 200);

      // If we already have some data, we need to fetch from offset
      const currentOffset = cache.fetchedLimit;

      const responses = await Promise.all(entityIds.map(entityId => fetchEntityDonations(entityId, {
        limit: fetchLimit,
        offset: currentOffset,
      })));

      // Get existing donations and add new ones
      const newDonations: PersonDonation[] = responses.flatMap((response, index) => {
        const detail = entityDetails.find(item => item.entity_id === entityIds[index]);
        const entityName = detail?.display_name || `Entity ${entityIds[index]}`;
        return (response.data || []).map(donation => ({
          donation_id: donation.donation_id,
          entity_id: entityIds[index],
          entity_name: entityName,
          date: donation.date,
          amount: donation.amount,
          type: 'CONTRIBUTION',
          description: donation.report_name,
          donor_name: donation.donor_name,
        }));
      });

      // Combine with existing cache
      const allDonations = [...cache.donations, ...newDonations];

      // Sort all donations by date (newest first)
      allDonations.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Determine if there are more donations available from any entity
      const hasMore = responses.some(response => response.has_more);

      donationCacheRef.current = {
        donations: allDonations,
        fetchedLimit: currentOffset + fetchLimit,
        hasMore,
      };

      const slice = allDonations.slice(page * DONATION_PAGE_SIZE, (page + 1) * DONATION_PAGE_SIZE);
      setDonations(slice);
      setDonationsPage(page);
      setDonationsHasMore(hasMore || allDonations.length > (page + 1) * DONATION_PAGE_SIZE);
    } catch (err) {
      setDonationsError(err instanceof Error ? err.message : 'Failed to load donations.');
      if (page === 0) {
        setDonations([]);
        setDonationsHasMore(false);
      }
    } finally {
      setDonationsLoading(false);
    }
  }, [personId, finance?.entity_details]);

  const handleDonationPageChange = useCallback(async (direction: 'next' | 'prev') => {
    if (donationsLoading) return;
    if (direction === 'prev') {
      if (donationsPage === 0) return;
      await loadDonations(donationsPage - 1);
      return;
    }

    // For next page, check if we need to load more data
    const cache = donationCacheRef.current;
    const nextPageStart = (donationsPage + 1) * DONATION_PAGE_SIZE;
    const hasDataInCache = cache.donations.length > nextPageStart;
    const canLoadMore = cache.hasMore;

    if (!hasDataInCache && !canLoadMore) {
      return; // No more data available
    }

    await loadDonations(donationsPage + 1);
  }, [donationsLoading, donationsPage, loadDonations]);

  const ensureTopDonors = useCallback(async (entityId: number, page: number = 0) => {
    if (!Number.isFinite(entityId) || entityId <= 0) return;
    const required = Math.min(TOP_DONOR_FETCH_LIMIT, (page + 1) * TOP_DONOR_PAGE_SIZE);
    const snapshot = topDonorState[entityId];
    if (snapshot && snapshot.donors.length >= required) {
      setTopDonorPage(page);
      return;
    }

    setTopDonorsLoading(true);
    setTopDonorError(null);
    try {
      const donors = await fetchEntityTopDonors(entityId, required);
      const hasMore = donors.length === required && required < TOP_DONOR_FETCH_LIMIT;
      setTopDonorState(prev => ({
        ...prev,
        [entityId]: {
          donors,
          fetchedLimit: required,
          hasMore,
        },
      }));
      const maxPage = Math.max(0, Math.ceil(donors.length / TOP_DONOR_PAGE_SIZE) - 1);
      setTopDonorPage(Math.min(page, maxPage));
    } catch (err) {
      setTopDonorError(err instanceof Error ? err.message : 'Failed to load top donors.');
    } finally {
      setTopDonorsLoading(false);
    }
  }, [topDonorState]);

  const handleTopDonorPageChange = useCallback(async (direction: 'next' | 'prev') => {
    if (!topDonorEntityId || topDonorsLoading) return;
    if (direction === 'prev') {
      if (topDonorPage === 0) return;
      setTopDonorPage(topDonorPage - 1);
      return;
    }
    const snapshot = topDonorState[topDonorEntityId];
    if (snapshot) {
      const required = (topDonorPage + 2) * TOP_DONOR_PAGE_SIZE;
      if (snapshot.donors.length >= required) {
        setTopDonorPage(topDonorPage + 1);
        return;
      }
      if (!snapshot.hasMore) {
        return;
      }
    }
    await ensureTopDonors(topDonorEntityId, topDonorPage + 1);
  }, [topDonorEntityId, topDonorPage, topDonorsLoading, topDonorState, ensureTopDonors]);

  const handleTopDonorEntityChange = useCallback((entityId: number) => {
    setTopDonorEntityId(entityId);
    setTopDonorPage(0);
    if (!topDonorState[entityId]) {
      void ensureTopDonors(entityId, 0);
    }
  }, [ensureTopDonors, topDonorState]);

  const handleFinanceTabChange = useCallback((tab: 'entities' | 'donations' | 'topDonors') => {
    setFinanceTab(tab);
  }, []);

  useEffect(() => {
    if (!Number.isFinite(personId) || personId <= 0) {
      setError('Invalid person identifier.');
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setWarning(null);
      const warnings: string[] = [];
      let fatalError: string | null = null;

      try {
        const [overviewResult, sessionsResult, financeResult] = await Promise.allSettled([
          fetchPersonOverview(personId),
          fetchPersonSessions(personId),
          fetchPersonFinanceOverview(personId),
        ]);

        if (cancelled) return;

        const overviewData = overviewResult.status === 'fulfilled' ? overviewResult.value ?? null : null;
        if (overviewResult.status === 'rejected') {
          console.warn('Failed to load person overview', overviewResult.reason);
          warnings.push('Overview data timed out; some profile metrics may be missing.');
        }

        const sessionsData = sessionsResult.status === 'fulfilled' ? sessionsResult.value ?? [] : [];
        if (sessionsResult.status === 'rejected') {
          console.warn('Failed to load person sessions', sessionsResult.reason);
          warnings.push('Session history is temporarily unavailable.');
        }

        const financeData = financeResult.status === 'fulfilled' ? financeResult.value ?? null : null;
        if (financeResult.status === 'rejected') {
          console.warn('Failed to load person finance overview', financeResult.reason);
          warnings.push('Campaign finance summary could not be loaded.');
        }

        setOverview(overviewData);
        setSessions(sessionsData);
        setFinance(financeData);
        setSessionVoteState({});
        setSessionVoteErrors({});
        setExpandedSession(null);
        setExpandedBills(new Set());
        setBillDetailMap(new Map());
        setBillRollCallMap(new Map());
        setBillErrors(new Map());
        setFinanceTab('entities');
        setDonations([]);
        setDonationsPage(0);
        setDonationsHasMore(false);
        setDonationsError(null);
        setTopDonorState({});
        setTopDonorPage(0);
        setTopDonorError(null);
        const defaultEntityId = financeData?.entity_details?.[0]?.entity_id ?? null;
        setTopDonorEntityId(defaultEntityId);

        const displayName = overviewData?.full_name || financeData?.entity_details?.[0]?.display_name;
        if (displayName) {
          try {
            const matches = await searchPeopleWithSessions({ query: displayName, limit: 10 });
            if (!cancelled) {
              const match = matches.find((m) => m.person_id === personId) ?? matches[0] ?? null;
              setSearchSummary(match ?? null);
            }
          } catch (searchErr) {
            console.warn('Failed to enrich search summary', searchErr);
            warnings.push('Directory lookup failed, showing limited profile details.');
            if (!cancelled) {
              setSearchSummary(null);
            }
          }
        } else {
          if (!cancelled) {
            setSearchSummary(null);
          }
        }

        try {
          const voteResponse = await fetchPersonVotes(personId, undefined, { limit: 5, offset: 0 });
          if (!cancelled) {
            setRecentVotes(voteResponse.data ?? []);
          }
        } catch (votesErr) {
          console.warn('Failed to load recent votes', votesErr);
          warnings.push('Recent vote summary could not be retrieved.');
          if (!cancelled) {
            setRecentVotes([]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load person data', err);
          fatalError = err instanceof Error ? err.message : 'Failed to load person data.';
        }
      } finally {
        if (!cancelled) {
          setWarning(warnings.length ? warnings.join(' ') : null);
          setError(fatalError);
          setLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [personId]);

  useEffect(() => {
    const firstEntityId = finance?.entity_details?.[0]?.entity_id;
    if (!firstEntityId) {
      setTopDonorEntityId(null);
      setTopDonorPage(0);
      return;
    }

    const currentExists = finance.entity_details.some(entity => entity.entity_id === topDonorEntityId);
    if (!topDonorEntityId || !currentExists) {
      setTopDonorEntityId(firstEntityId);
      setTopDonorPage(0);
    }
  }, [finance?.entity_details, topDonorEntityId]);

  useEffect(() => {
    if (financeTab !== 'donations') return;
    if (donations.length > 0 || donationsLoading) return;
    void loadDonations(0);
  }, [financeTab, donations.length, donationsLoading, loadDonations]);

  useEffect(() => {
    if (financeTab !== 'topDonors' || !topDonorEntityId) return;
    if (topDonorState[topDonorEntityId] || topDonorsLoading) return;
    void ensureTopDonors(topDonorEntityId, 0);
  }, [financeTab, topDonorEntityId, topDonorState, topDonorsLoading, ensureTopDonors]);

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

  const currentSessionSnapshot = expandedSession ? sessionVoteState[expandedSession] : undefined;
  const currentSessionVotes = currentSessionSnapshot?.items ?? [];
  const currentSessionLoading = currentSessionSnapshot?.loading ?? false;
  const currentSessionHasMore = currentSessionSnapshot?.hasMore ?? false;
  const currentSessionError = expandedSession ? sessionVoteErrors[expandedSession] : null;

  const currentTopDonorSnapshot = topDonorEntityId ? topDonorState[topDonorEntityId] : undefined;
  const topDonorRows = currentTopDonorSnapshot
    ? currentTopDonorSnapshot.donors.slice(
        topDonorPage * TOP_DONOR_PAGE_SIZE,
        (topDonorPage + 1) * TOP_DONOR_PAGE_SIZE
      )
    : [];
  const topDonorHasMore = currentTopDonorSnapshot
    ? currentTopDonorSnapshot.hasMore ||
      currentTopDonorSnapshot.donors.length > (topDonorPage + 1) * TOP_DONOR_PAGE_SIZE
    : false;

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

      {!error && warning && (
        <div style={{ padding: '1rem', border: '1px solid #fcd34d', backgroundColor: '#fffbeb', color: '#b45309', borderRadius: '0.5rem' }}>
          {warning}
        </div>
      )}

      {loading && <div style={{ color: '#6b7280' }}>Loading person data…</div>}

      {!loading && !error && (
        <>
          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
              Campaign Finance
            </h2>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Total Raised</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669' }}>
                  {formatCurrency(finance?.total_raised)}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Total Spent</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                  {formatCurrency(finance?.total_spent)}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Registered Committees</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f2937' }}>
                  {(finance?.entity_count ?? 0).toLocaleString('en-US')}
                </div>
              </div>
              <div style={metricStyle}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Transactions</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f2937' }}>
                  {(finance?.transaction_count ?? 0).toLocaleString('en-US')}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button type="button" onClick={() => handleFinanceTabChange('entities')} style={tabButtonStyle(financeTab === 'entities')}>
                Entities
              </button>
              <button type="button" onClick={() => handleFinanceTabChange('donations')} style={tabButtonStyle(financeTab === 'donations')}>
                Donations
              </button>
              <button type="button" onClick={() => handleFinanceTabChange('topDonors')} style={tabButtonStyle(financeTab === 'topDonors')}>
                Top Donors
              </button>
            </div>

            {financeTab === 'entities' && (
              entityDetails.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {entityDetails.map(entity => (
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
              ) : (
                <div style={{ padding: '1.25rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', color: '#6b7280' }}>
                  No linked campaign finance entities found for this person.
                </div>
              )
            )}

            {financeTab === 'donations' && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.75rem', padding: '1rem', backgroundColor: '#ffffff' }}>
                {donationsError && (
                  <div style={{ marginBottom: '0.75rem', color: '#b91c1c' }}>{donationsError}</div>
                )}
                {donationsLoading ? (
                  <div style={{ color: '#6b7280' }}>Loading donations…</div>
                ) : donations.length === 0 ? (
                  <div style={{ color: '#6b7280' }}>No donation records available.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                      <thead style={{ backgroundColor: '#f9fafb' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Amount</th>
                          <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Donor</th>
                          <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Recipient Entity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {donations.map(donation => (
                          <tr key={donation.donation_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '0.75rem' }}>{formatDate(donation.date)}</td>
                            <td style={{ padding: '0.75rem', color: '#059669', fontWeight: 600 }}>{formatCurrency(donation.amount)}</td>
                            <td style={{ padding: '0.75rem' }}>{donation.donor_name || 'Unknown donor'}</td>
                            <td style={{ padding: '0.75rem' }}>{donation.entity_name || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => handleDonationPageChange('prev')}
                    disabled={donationsPage === 0 || donationsLoading}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', backgroundColor: '#ffffff', color: '#1d4ed8', cursor: (donationsPage === 0 || donationsLoading) ? 'not-allowed' : 'pointer' }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDonationPageChange('next')}
                    disabled={!donationsHasMore || donationsLoading}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #1d4ed8', backgroundColor: '#1d4ed8', color: '#ffffff', cursor: (!donationsHasMore || donationsLoading) ? 'not-allowed' : 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {financeTab === 'topDonors' && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.75rem', padding: '1rem', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {entityDetails.length === 0 ? (
                  <div style={{ color: '#6b7280' }}>No committees available for donor analysis.</div>
                ) : (
                  <>
                    {entityDetails.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <label htmlFor="top-donor-entity" style={{ fontSize: '0.85rem', color: '#4b5563' }}>Committee</label>
                        <select
                          id="top-donor-entity"
                          value={topDonorEntityId ?? ''}
                          onChange={(event) => {
                            const nextId = Number(event.target.value);
                            if (Number.isFinite(nextId) && nextId > 0) {
                              handleTopDonorEntityChange(nextId);
                            }
                          }}
                          style={{ padding: '0.4rem 0.6rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', minWidth: '200px' }}
                        >
                          {entityDetails.map(entity => (
                            <option key={entity.entity_id} value={entity.entity_id}>
                              {entity.display_name || `Entity ${entity.entity_id}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {topDonorError && <div style={{ color: '#b91c1c' }}>{topDonorError}</div>}
                    {topDonorsLoading && <div style={{ color: '#6b7280' }}>Loading top donors…</div>}
                    {!topDonorsLoading && topDonorRows.length === 0 && !topDonorError && (
                      <div style={{ color: '#6b7280' }}>No donor totals available yet.</div>
                    )}
                    {topDonorRows.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                          <thead style={{ backgroundColor: '#f9fafb' }}>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Donor</th>
                              <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Total</th>
                              <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Contributions</th>
                              <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Employer / Occupation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topDonorRows.map(donor => (
                              <tr key={donor.transaction_entity_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '0.75rem', fontWeight: 600 }}>{donor.entity_name}</td>
                                <td style={{ padding: '0.75rem', color: '#059669', fontWeight: 600 }}>{formatCurrency(donor.total_to_recipient)}</td>
                                <td style={{ padding: '0.75rem' }}>{(donor.donation_count ?? 0).toLocaleString('en-US')}</td>
                                <td style={{ padding: '0.75rem', color: '#4b5563' }}>
                                  {[donor.top_employer, donor.top_occupation].filter(Boolean).join(' • ') || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => handleTopDonorPageChange('prev')}
                        disabled={topDonorPage === 0 || topDonorsLoading}
                        style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', backgroundColor: '#ffffff', color: '#1d4ed8', cursor: (topDonorPage === 0 || topDonorsLoading) ? 'not-allowed' : 'pointer' }}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTopDonorPageChange('next')}
                        disabled={!topDonorHasMore || topDonorsLoading}
                        style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #1d4ed8', backgroundColor: '#1d4ed8', color: '#ffffff', cursor: (!topDonorHasMore || topDonorsLoading) ? 'not-allowed' : 'pointer' }}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
              Overview
            </h2>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.75rem', backgroundColor: '#ffffff', padding: '1rem', display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Party</div>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>{searchSummary?.party || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Chamber</div>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>
                  {searchSummary?.body ? `${searchSummary.body}${searchSummary?.district ? ` · District ${searchSummary.district}` : ''}` : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Total Votes Recorded</div>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>{(overview?.total_votes ?? 0).toLocaleString('en-US')}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Bills Sponsored</div>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>{(overview?.total_bills_sponsored ?? 0).toLocaleString('en-US')}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Active Sessions</div>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>
                  {overview?.sessions_served && overview.sessions_served.length > 0 ? overview.sessions_served.join(', ') : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280' }}>Activity Window</div>
                <div style={{ fontWeight: 600, color: '#1f2937' }}>
                  {finance?.first_activity || finance?.last_activity
                    ? `${formatDate(finance?.first_activity)} → ${formatDate(finance?.last_activity)}`
                    : '—'}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
              Legislative Sessions
            </h2>
            {sessions.length === 0 ? (
              <div style={{ padding: '1.25rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', color: '#6b7280' }}>
                No session activity recorded for this person yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {sessions.map(session => {
                  const isExpanded = expandedSession === session.session_id;
                  const sessionRange = formatDateRange(session.start_date ?? session.first_vote_date, session.end_date ?? session.last_vote_date);
                  const sessionSnapshot = isExpanded ? currentSessionSnapshot : sessionVoteState[session.session_id];
                  const sessionPage = sessionSnapshot?.page ?? 0;
                  const sessionHasMore = isExpanded ? currentSessionHasMore : sessionSnapshot?.hasMore ?? false;
                  const sessionErrorMessage = isExpanded ? currentSessionError : sessionVoteErrors[session.session_id] ?? null;
                  const sessionVotes = isExpanded ? currentSessionVotes : sessionSnapshot?.items ?? [];
                  const sessionLoading = isExpanded ? currentSessionLoading : sessionSnapshot?.loading ?? false;

                  return (
                    <div key={session.session_id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.75rem', overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => handleSessionToggle(session.session_id)}
                        style={{ width: '100%', textAlign: 'left', padding: '1rem', background: '#f8fafc', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: '#1f2937' }}>{session.session_name}</div>
                          <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>{sessionRange}</div>
                        </div>
                        <div style={{ color: '#1f2937', fontWeight: 600 }}>{session.vote_count} votes</div>
                      </button>
                      {isExpanded && (
                        <div style={{ padding: '1rem', borderTop: '1px solid #e5e7eb', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {sessionErrorMessage && <div style={{ color: '#b91c1c' }}>{sessionErrorMessage}</div>}
                          {sessionLoading && <div style={{ color: '#6b7280' }}>Loading votes…</div>}
                          {!sessionLoading && sessionVotes.length === 0 && !sessionErrorMessage && (
                            <div style={{ color: '#6b7280' }}>No votes recorded for this session.</div>
                          )}
                          {sessionVotes.map(vote => {
                            const billExpanded = expandedBills.has(vote.bill_id);
                            const details = billDetailMap.get(vote.bill_id);
                            const rollCall = billRollCallMap.get(vote.bill_id);
                            const billError = billErrors.get(vote.bill_id);
                            const isBillLoading = billLoading.has(vote.bill_id);
                            const summaryText = (details?.bill_summary || details?.bill_text || '')?.trim();
                            const previewText = summaryText && summaryText.length > 700 ? `${summaryText.slice(0, 700)}…` : summaryText;

                            return (
                              <div key={`${session.session_id}-${vote.bill_id}`} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.8rem 1rem', background: '#f9fafb', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                                  <div>
                                    <div style={{ fontWeight: 600, color: '#1f2937' }}>{vote.bill_number}: {vote.short_title || 'Untitled Bill'}</div>
                                    <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                                      Last vote {formatDate(vote.latest_vote_date)} • {vote.latest_vote} • {vote.vote_count} roll call{vote.vote_count === 1 ? '' : 's'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleBillToggle(vote.bill_id)}
                                    style={{ border: '1px solid #1d4ed8', borderRadius: '0.5rem', padding: '0.35rem 0.65rem', backgroundColor: billExpanded ? '#1d4ed8' : '#ffffff', color: billExpanded ? '#ffffff' : '#1d4ed8', cursor: 'pointer', fontSize: '0.85rem' }}
                                  >
                                    {billExpanded ? 'Hide details' : 'View details'}
                                  </button>
                                </div>
                                {billExpanded && (
                                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {billError && <div style={{ color: '#b91c1c' }}>{billError}</div>}
                                    {isBillLoading && <div style={{ color: '#6b7280' }}>Loading bill details…</div>}
                                    {!isBillLoading && !billError && (
                                      <>
                                        {previewText ? (
                                          <div style={{ color: '#374151', lineHeight: 1.5 }}>
                                            <strong>Summary:</strong> {previewText}
                                          </div>
                                        ) : (
                                          <div style={{ color: '#6b7280' }}>No summary text available.</div>
                                        )}
                                        {rollCall && rollCall.length > 0 && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {rollCall.map(group => (
                                              <div key={`${vote.bill_id}-${group.vote_date}-${group.venue}`} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem', background: '#ffffff' }}>
                                                <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '0.35rem' }}>
                                                  {formatDate(group.vote_date)} • {group.venue}{group.committee_name ? ` (${group.committee_name})` : ''}
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem' }}>
                                                  <div><strong>Yes ({group.totals.yes}):</strong> {group.votes.yes.map(v => v.legislator_name).join(', ') || '—'}</div>
                                                  <div><strong>No ({group.totals.no}):</strong> {group.votes.no.map(v => v.legislator_name).join(', ') || '—'}</div>
                                                  <div><strong>Other ({group.totals.other}):</strong> {group.votes.other.map(v => v.legislator_name).join(', ') || '—'}</div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button
                              type="button"
                              onClick={() => handleSessionPageChange(session.session_id, 'prev')}
                              disabled={sessionPage === 0 || sessionLoading}
                              style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', backgroundColor: '#ffffff', color: '#1d4ed8', cursor: (sessionPage === 0 || sessionLoading) ? 'not-allowed' : 'pointer' }}
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSessionPageChange(session.session_id, 'next')}
                              disabled={!sessionHasMore || sessionLoading}
                              style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #1d4ed8', backgroundColor: '#1d4ed8', color: '#ffffff', cursor: (!sessionHasMore || sessionLoading) ? 'not-allowed' : 'pointer' }}
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {recentVotes.length > 0 && (
            <section>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
                Recent Votes
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {recentVotes.map((vote: any) => (
                  <div
                    key={`${vote.vote_id}-${vote.bill_id}`}
                    style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem 1rem', backgroundColor: '#ffffff' }}
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
        </>
      )}
    </div>
  );
};

export default PersonPage;
