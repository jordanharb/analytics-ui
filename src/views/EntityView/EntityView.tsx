import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { analyticsClient } from '../../api/analyticsClient';
import { useFiltersStore } from '../../state/filtersStore';
import { EventCard } from '../../components/EventCard/EventCard';
import { ActivityChart } from '../../components/ActivityChart/ActivityChart';
import { getUniqueValidStates } from '../../utils/stateUtils';
import { getOrderedMetadataFields } from '../../utils/metadataUtils';
import { SocialProfile } from '../../components/SocialProfile/SocialProfile';
import type { EntityDetails, EntityStats, EventSummary, ActorLink, TimeseriesResponse } from '../../api/types';

interface ProfileFormState {
  name: string;
  actor_type: string;
  city: string;
  state: string;
  region: string;
  about: string;
  should_scrape: boolean;
}

type RelationshipDraftMap = Record<string, { relationship: string; role: string }>;
type StatusMessage = { type: 'success' | 'error'; text: string } | null;

const ACTOR_TYPE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'person', label: 'People' },
  { id: 'organization', label: 'Organizations' },
  { id: 'chapter', label: 'Chapters' },
];

const relationshipKey = (relationship: ActorRelationship): string =>
  relationship.id ?? `${relationship.from_actor_id}:${relationship.to_actor_id}:${relationship.relationship ?? 'null'}:${relationship.created_at ?? 'created'}`;

const normalizeText = (value: string | null | undefined): string => (value ?? '').trim();

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;
import {
  fetchActorDetails,
  fetchActorMembers,
  fetchActorRelationships,
  fetchActorInboundRelationships,
  fetchActorUsernames,
  updateActorDetails,
  searchActorsForLinking,
  createActorRelationship,
  deleteActorRelationship,
  updateActorRelationship,
} from '../../api/actorsDirectoryService';
import type { Actor, ActorMember, ActorRelationship, ActorUsername } from '../../types/actorsDirectory';

// fieldnotes palette
// page #f6f1e6   surface #fdfaf2   ink #1a1a1a   muted #6b6b6b   faint #9a9a9a
// accent #c2410c (burnt orange)    accent text #9a330a   coral fill #fdf2ed
// neutral fill #ede5d2

export const EntityView: React.FC = () => {
  const { entityType, entityId } = useParams<{ entityType: string; entityId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { filters } = useFiltersStore();

  const [details, setDetails] = useState<EntityDetails | null>(null);
  const [stats, setStats] = useState<EntityStats | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalEvents, setTotalEvents] = useState(0);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'overview' | 'network' | 'activity'>('overview');
  const [exporting, setExporting] = useState(false);
  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);
  // Default to "all time" so the page lands on the most useful view for actors
  // with deep history but no recent activity (the previous default of 'month' caused
  // the empty-stat / empty-chart problem on actors like TPUSA Students).
  const [timeseriesPeriod, setTimeseriesPeriod] = useState<'week' | 'month' | 'year' | 'all'>('all');
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);
  const [networkActorIds, setNetworkActorIds] = useState<string[]>([]);
  const [networkMode, setNetworkMode] = useState(true); // default: include network
  const [networkEvents, setNetworkEvents] = useState<EventSummary[]>([]);
  const [networkEventsLoading, setNetworkEventsLoading] = useState(false);
  const [statsScope, setStatsScope] = useState<'direct' | 'network'>('network');
  const [networkStats, setNetworkStats] = useState<EntityStats | null>(null);
  const [networkStatsLoading, setNetworkStatsLoading] = useState(false);

  // Active stats: network stats when scope=network and available, otherwise direct
  const activeStats = useMemo(() => {
    if (statsScope === 'network' && networkStats) return networkStats;
    return stats;
  }, [statsScope, networkStats, stats]);

  const validStateStats = useMemo(() => {
    if (!activeStats?.by_state) return { validCount: 0, statesByCode: new Map() };
    return getUniqueValidStates(activeStats.by_state);
  }, [activeStats]);

  const metadataFields = useMemo(() => {
    if (!details?.metadata) return [];
    return getOrderedMetadataFields(details.metadata);
  }, [details?.metadata]);

  const extraMetadataFields = useMemo(() => {
    return metadataFields.filter(field => !['About', 'Type', 'City', 'State'].includes(field.label));
  }, [metadataFields]);

  // Helpers to pull common metadata fields cleanly
  const aboutText = useMemo(() => metadataFields.find(f => f.label === 'About')?.value as string | undefined, [metadataFields]);
  const actorTypeLabel = useMemo(() => {
    const f = metadataFields.find(f => ['actor_type', 'Type'].includes(f.label));
    return (f?.value as string | undefined)?.toLowerCase();
  }, [metadataFields]);
  const cityLabel = useMemo(() => metadataFields.find(f => f.label === 'City')?.value as string | undefined, [metadataFields]);
  const stateLabel = useMemo(() => metadataFields.find(f => f.label === 'State')?.value as string | undefined, [metadataFields]);
  const regionLabel = useMemo(() => metadataFields.find(f => f.label === 'Region')?.value as string | undefined, [metadataFields]);
  const categoryLabel = useMemo(() => {
    const f = metadataFields.find(f => f.label === 'Category' || f.label === 'category');
    return (f?.value as string | undefined)?.toLowerCase();
  }, [metadataFields]);

  // Load entity details
  useEffect(() => {
    if (!entityType || !entityId) return;

    const loadDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const entityOnlyFilters = { period: timeseriesPeriod };

        const [detailsData, statsData, timeseriesData] = await Promise.all([
          analyticsClient.getEntityDetails(entityType as any, entityId),
          analyticsClient.getEntityStats(entityType as any, entityId, entityOnlyFilters),
          analyticsClient.getEntityTimeseries(entityType as any, entityId, entityOnlyFilters, timeseriesPeriod),
        ]);

        setDetails(detailsData);
        setStats(statsData);
        setTimeseries(timeseriesData);
        setLoading(false);

        if (entityType === 'actor') {
          void (async () => {
            try {
              // Query both directions to catch chapters pointing TO this org and orgs this actor belongs to
              const [outbound, inbound] = await Promise.all([
                fetchActorRelationships(entityId),
                fetchActorInboundRelationships(entityId),
              ]);
              const linked = [...new Set([
                ...outbound.map(r => r.to_actor_id),
                ...inbound.map(r => r.from_actor_id),
              ].filter((id): id is string => !!id && id !== entityId))];
              setNetworkActorIds(linked);

              if (linked.length === 0) return;

              setNetworkStatsLoading(true);
              try {
                const networkResults = await Promise.all(
                  linked.slice(0, 20).map(id =>
                    analyticsClient.getEntityStats('actor', id, { period: timeseriesPeriod }),
                  ),
                );
                const mergeGeo = (arrays: any[][]): any[] => {
                  const map = new Map<string, any>();
                  arrays.flat().forEach(item => {
                    const key = `${item.city ?? ''}|${item.state ?? ''}`;
                    if (map.has(key)) map.get(key).count += item.count;
                    else map.set(key, { ...item });
                  });
                  return Array.from(map.values()).sort((a, b) => b.count - a.count);
                };
                const mergeState = (arrays: any[][]): any[] => {
                  const map = new Map<string, any>();
                  arrays.flat().forEach(item => {
                    const key = item.state ?? item.code ?? '';
                    if (map.has(key)) map.get(key).count += item.count;
                    else map.set(key, { ...item });
                  });
                  return Array.from(map.values()).sort((a, b) => b.count - a.count);
                };
                setNetworkStats({
                  total_count: networkResults.reduce((s: number, r: any) => s + (r.total_count ?? 0), statsData.total_count),
                  by_city: mergeGeo([statsData.by_city ?? [], ...networkResults.map((r: any) => r.by_city ?? [])]),
                  by_state: mergeState([statsData.by_state ?? [], ...networkResults.map((r: any) => r.by_state ?? [])]),
                } as any);
              } finally {
                setNetworkStatsLoading(false);
              }
            } catch {
              // non-fatal — page already showing direct stats
            }
          })();
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load entity details');
        console.error('Error loading entity:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [entityType, entityId, timeseriesPeriod]);

  // Load events
  const loadEvents = useCallback(async (isInitial = false) => {
    if (!entityType || !entityId || eventsLoading) return;

    setEventsLoading(true);

    try {
      const entityFilters = { ...filters, period: 'all' as const };

      const response = await analyticsClient.getEntityEvents(
        entityType as any,
        entityId,
        entityFilters,
        50,
        isInitial ? undefined : cursor,
      );

      const newEvents = isInitial ? response.events : [...events, ...response.events];
      const uniqueEvents = Array.from(new Map(newEvents.map(e => [e.id, e])).values()).sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
      });

      setEvents(uniqueEvents);
      setTotalEvents(response.total_count);
      setCursor(response.next_cursor);
      setHasMore(response.has_more);
    } catch (err: any) {
      console.error('Error loading events:', err);
    } finally {
      setEventsLoading(false);
    }
  }, [entityType, entityId, cursor, events, eventsLoading, filters]);

  useEffect(() => {
    loadEvents(true);
  }, [entityType, entityId, filters]);

  const loadNetworkEvents = useCallback(async () => {
    if (networkActorIds.length === 0 || networkEventsLoading) return;
    setNetworkEventsLoading(true);
    try {
      const entityFilters = { ...filters, period: 'all' as const };
      const results = await Promise.all(
        networkActorIds.slice(0, 20).map(id => analyticsClient.getEntityEvents('actor', id, entityFilters, 50)),
      );
      const all = results.flatMap(r => r.events);
      const deduped = Array.from(new Map(all.map(e => [e.id, e])).values()).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      setNetworkEvents(deduped);
    } catch (err) {
      console.error('Error loading network events:', err);
    } finally {
      setNetworkEventsLoading(false);
    }
  }, [networkActorIds, filters, networkEventsLoading]);

  useEffect(() => {
    if (networkMode && networkEvents.length === 0) {
      loadNetworkEvents();
    }
  }, [networkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleExpand = (eventId: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const navigateToActor = (actorId: string) => {
    navigate(`/entity/actor/${actorId}`);
  };

  // Load timeseries data for different periods
  const loadTimeseries = useCallback(
    async (period: 'week' | 'month' | 'year' | 'all') => {
      if (!entityType || !entityId || timeseriesLoading) return;

      setTimeseriesLoading(true);
      setTimeseriesPeriod(period);

      let granularity: 'day' | 'week' | 'month' | 'year' | 'auto';
      switch (period) {
        case 'week':
          granularity = 'day';
          break;
        case 'month':
          granularity = 'day';
          break;
        case 'year':
          granularity = 'week';
          break;
        case 'all':
          granularity = 'week';
          break;
        default:
          granularity = 'auto';
      }

      try {
        const timeseriesFilters = { period };
        const data = await analyticsClient.getEntityTimeseries(entityType as any, entityId, timeseriesFilters, period, granularity);
        setTimeseries(data);
      } catch (err: any) {
        console.error('Error loading timeseries:', err);
        setTimeseries(null);
      } finally {
        setTimeseriesLoading(false);
      }
    },
    [entityType, entityId, filters, timeseriesLoading],
  );

  // ---- header sentence ----
  // Builds: "college & HS activist network; start-a-chapter hub. 2,017 events on file across 47 states."
  const headerSentence = useMemo(() => {
    const parts: string[] = [];
    if (aboutText && aboutText.trim()) {
      const cleaned = aboutText.trim().replace(/\s+/g, ' ');
      parts.push(cleaned.endsWith('.') ? cleaned : cleaned + '.');
    }

    const total = details?.global_count;
    const stateCount = validStateStats.validCount;
    const totalLine: string[] = [];
    if (total !== undefined && total !== null) {
      totalLine.push(`${total.toLocaleString()} events on file`);
    }
    if (stateCount > 0) {
      totalLine.push(`across ${stateCount} ${stateCount === 1 ? 'state' : 'states'}`);
    }
    if (totalLine.length > 0) parts.push(totalLine.join(' ') + '.');

    return parts.join(' ');
  }, [aboutText, details?.global_count, validStateStats.validCount]);

  const isActor = details?.type === 'actor';
  const hasNetwork =
    isActor &&
    details &&
    ((details.links_primary && details.links_primary.length > 0) ||
      (details.links_out && details.links_out.length > 0) ||
      (details.links_in && details.links_in.length > 0));

  // Closest connections preview — pull from links_primary if present,
  // otherwise fall back to links_out, then links_in
  const closestConnections = useMemo(() => {
    if (!details) return [] as ActorLink[];
    const seen = new Set<string>();
    const out: ActorLink[] = [];
    const sources: ActorLink[][] = [
      details.links_primary ?? [],
      details.links_out ?? [],
      details.links_in ?? [],
    ];
    for (const src of sources) {
      for (const link of src) {
        if (!link.other_actor_id || seen.has(link.other_actor_id)) continue;
        seen.add(link.other_actor_id);
        out.push(link);
        if (out.length >= 5) return out;
      }
    }
    return out;
  }, [details]);

  const networkCount = useMemo(() => {
    if (networkActorIds.length > 0) return networkActorIds.length;
    if (!details) return 0;
    const seen = new Set<string>();
    [...(details.links_primary ?? []), ...(details.links_out ?? []), ...(details.links_in ?? [])].forEach(l => {
      if (l.other_actor_id) seen.add(l.other_actor_id);
    });
    return seen.size;
  }, [networkActorIds.length, details]);

  // ---- early returns ----
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#f6f1e6]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-[#c2410c] border-t-transparent"></div>
          <p className="mt-2 text-sm text-[#6b6b6b]">loading…</p>
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="h-full flex items-center justify-center bg-[#f6f1e6]">
        <div className="text-center">
          <p className="text-[#9a330a] text-sm">{error || 'Entity not found'}</p>
          <button
            onClick={() => {
              const fromLocation = (location.state as any)?.from;
              if (fromLocation) navigate(fromLocation);
              else navigate(-1);
            }}
            className="mt-4 text-[#c2410c] hover:text-[#9a330a] text-sm underline"
          >
            go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f6f1e6]" style={{ WebkitOverflowScrolling: 'touch' }}>
      {/* ----- HEADER ----- */}
      <div className="bg-[#fdfaf2] border-b border-black/[0.08]">
        <div className="px-4 md:px-8 pt-5 md:pt-6 pb-3 max-w-[1300px] mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">
                <a onClick={() => navigate('/actors')} className="hover:text-[#c2410c] cursor-pointer">directory</a>
                <span className="mx-1.5">·</span>
                <span>{details.type}</span>
              </div>

              <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
                <h1
                  className="text-[20px] md:text-[22px] font-medium text-[#1a1a1a] leading-tight tracking-tight"
                  style={{ fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' }}
                >
                  {details.name}
                </h1>
                {actorTypeLabel && (
                  <span
                    className="text-[10px]"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 11,
                      background: '#fdf2ed',
                      color: '#9a330a',
                      border: '0.5px solid rgba(194,65,12,0.2)',
                    }}
                  >
                    {actorTypeLabel}
                  </span>
                )}
                {categoryLabel && (
                  <span
                    className="text-[10px]"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 11,
                      background: '#ede5d2',
                      color: '#6b6b6b',
                    }}
                  >
                    {categoryLabel}
                  </span>
                )}
                {regionLabel && (
                  <span
                    className="text-[10px]"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 11,
                      background: '#ede5d2',
                      color: '#6b6b6b',
                    }}
                  >
                    {regionLabel.toLowerCase()}
                  </span>
                )}
                {(cityLabel || stateLabel) && (
                  <span
                    className="text-[10px]"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 11,
                      background: '#ede5d2',
                      color: '#6b6b6b',
                    }}
                  >
                    {[cityLabel, stateLabel].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>

              {headerSentence && (
                <p className="mt-2 text-[12px] md:text-[13px] text-[#6b6b6b] leading-relaxed max-w-2xl">
                  {headerSentence}
                </p>
              )}

              {/* Username pills */}
              {details.usernames && details.usernames.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {details.usernames
                    .filter(u => u.handle && u.handle.trim())
                    .map((username, idx) => (
                      <a
                        key={idx}
                        href={username.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] text-[#1a1a1a] hover:bg-[#ede5d2] transition-colors"
                        style={{
                          padding: '3px 9px',
                          borderRadius: 13,
                          background: '#fdfaf2',
                          border: '0.5px solid rgba(0,0,0,0.12)',
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: username.is_primary ? '#c2410c' : '#ede5d2',
                            color: username.is_primary ? '#fdfaf2' : '#6b6b6b',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 8,
                            fontWeight: 500,
                          }}
                        >
                          {username.platform?.[0]?.toLowerCase() ?? '·'}
                        </span>
                        <span className="text-[#6b6b6b]">{username.platform.toLowerCase()}</span>
                        <span>{username.handle.startsWith('@') ? username.handle : `@${username.handle}`}</span>
                      </a>
                    ))}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                const fromLocation = (location.state as any)?.from;
                if (fromLocation) navigate(fromLocation);
                else navigate(-1);
              }}
              className="flex-shrink-0 p-1.5 hover:bg-[#ede5d2] rounded-md text-[#9a9a9a] hover:text-[#1a1a1a] touch-manipulation"
              style={{ minHeight: 32, minWidth: 32 }}
              title="close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs row + scope toggle */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex gap-5 border-b border-black/[0.08] flex-1" style={{ marginBottom: '-1px' }}>
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-2 text-[13px] border-b-[1.5px] transition-colors whitespace-nowrap ${
                  activeTab === 'overview' ? 'border-[#c2410c] text-[#1a1a1a]' : 'border-transparent text-[#6b6b6b] hover:text-[#1a1a1a]'
                }`}
                style={{ minHeight: 36, marginBottom: '-1px' }}
              >
                overview
              </button>
              {hasNetwork && (
                <button
                  onClick={() => setActiveTab('network')}
                  className={`pb-2 text-[13px] border-b-[1.5px] transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === 'network' ? 'border-[#c2410c] text-[#1a1a1a]' : 'border-transparent text-[#6b6b6b] hover:text-[#1a1a1a]'
                  }`}
                  style={{ minHeight: 36, marginBottom: '-1px' }}
                >
                  network
                  {networkCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-[#ede5d2] text-[#6b6b6b] rounded-full tabular-nums">
                      {networkCount.toLocaleString()}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setActiveTab('activity')}
                className={`pb-2 text-[13px] border-b-[1.5px] transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === 'activity' ? 'border-[#c2410c] text-[#1a1a1a]' : 'border-transparent text-[#6b6b6b] hover:text-[#1a1a1a]'
                }`}
                style={{ minHeight: 36, marginBottom: '-1px' }}
              >
                activity
                {totalEvents > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[#ede5d2] text-[#6b6b6b] rounded-full tabular-nums">
                    {totalEvents.toLocaleString()}
                  </span>
                )}
              </button>
            </div>

            {/* Scope toggle — only when network actors exist */}
            {networkActorIds.length > 0 && (
              <div className="inline-flex bg-[#ede5d2] p-[3px] flex-shrink-0" style={{ borderRadius: 6 }}>
                <button
                  onClick={() => setStatsScope('direct')}
                  className="text-[11px] px-2.5 py-1 transition-colors focus:outline-none"
                  style={{
                    background: statsScope === 'direct' ? '#fdfaf2' : 'transparent',
                    color: statsScope === 'direct' ? '#1a1a1a' : '#6b6b6b',
                    fontWeight: statsScope === 'direct' ? 500 : 400,
                    borderRadius: 4,
                  }}
                >
                  direct
                </button>
                <button
                  onClick={() => setStatsScope('network')}
                  className="text-[11px] px-2.5 py-1 transition-colors focus:outline-none"
                  style={{
                    background: statsScope === 'network' ? '#fdfaf2' : 'transparent',
                    color: statsScope === 'network' ? '#1a1a1a' : '#6b6b6b',
                    fontWeight: statsScope === 'network' ? 500 : 400,
                    borderRadius: 4,
                  }}
                >
                  {networkStatsLoading ? 'loading…' : `+ network (${networkActorIds.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ----- TAB CONTENT ----- */}
      <div className="px-4 md:px-8 py-5 md:py-6 max-w-[1300px] mx-auto">
        {activeTab === 'overview' && activeStats && (
          <div className="space-y-4">
            {/* ---- Stat strip (single card, hairline dividers) ---- */}
            <div
              className="bg-[#fdfaf2] border border-black/[0.08] overflow-hidden"
              style={{ borderRadius: 8 }}
            >
              <div className="grid grid-cols-2 md:grid-cols-4">
                <StatCell
                  label="total events"
                  value={activeStats.total_count.toLocaleString()}
                  hint={
                    timeseriesPeriod === 'week'
                      ? 'past week'
                      : timeseriesPeriod === 'month'
                      ? 'past month'
                      : timeseriesPeriod === 'year'
                      ? 'past year'
                      : 'all time'
                  }
                  borderRight
                  borderBottomMobile
                />
                <StatCell
                  label="states reached"
                  value={String(validStateStats.validCount)}
                  inlineSecondary={`${(activeStats.by_city ?? []).length} cities`}
                  hint="geographic reach"
                  borderRight
                  borderBottomMobile
                />
                <StatCell
                  label="cadence"
                  value={timeseries ? Math.round(timeseries.summary.average).toLocaleString() : '—'}
                  inlineSecondary={timeseries ? `/ ${timeseries.granularity || 'period'}` : undefined}
                  hint="avg over selected window"
                  borderRight
                />
                <StatCell
                  label="trend"
                  trendValue={timeseries?.summary.trend}
                  hint={
                    timeseries
                      ? `peak: ${timeseries.summary.peak_count} on ${new Date(
                          timeseries.summary.peak_date,
                        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase()}`
                      : undefined
                  }
                />
              </div>
            </div>

            {/* ---- Activity chart ---- */}
            <div className="bg-[#fdfaf2] border border-black/[0.08]" style={{ borderRadius: 8 }}>
              <div className="px-4 md:px-5 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">activity timeline</div>
                <div className="inline-flex bg-[#ede5d2] p-[3px]" style={{ borderRadius: 6 }}>
                  {(['week', 'month', 'year', 'all'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => loadTimeseries(p)}
                      disabled={timeseriesLoading}
                      className="text-[11px] px-2.5 py-1 transition-colors focus:outline-none"
                      style={{
                        background: timeseriesPeriod === p ? '#fdfaf2' : 'transparent',
                        color: timeseriesPeriod === p ? '#1a1a1a' : '#6b6b6b',
                        fontWeight: timeseriesPeriod === p ? 500 : 400,
                        borderRadius: 4,
                      }}
                    >
                      {p === 'week' ? '7d' : p === 'month' ? '30d' : p === 'year' ? '1y' : 'all time'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-4 md:px-5 pb-4">
                {timeseriesLoading ? (
                  <div className="h-48 md:h-56 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#c2410c] border-t-transparent"></div>
                  </div>
                ) : timeseries ? (
                  <ActivityChart data={timeseries} height={typeof window !== 'undefined' && window.innerWidth < 768 ? 180 : 220} />
                ) : (
                  <div className="h-48 md:h-56 flex items-center justify-center text-[#9a9a9a] text-sm">
                    no activity data available
                  </div>
                )}
              </div>
            </div>

            {/* ---- 3-column row: top states · top cities · closest connections ---- */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Top states */}
              <div className="bg-[#fdfaf2] border border-black/[0.08] p-4" style={{ borderRadius: 8 }}>
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-3">top states</div>
                {validStateStats.validCount > 0 ? (
                  <div className="space-y-2">
                    {Array.from(validStateStats.statesByCode.entries())
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([stateCode, count], idx) => {
                        const max = Math.max(...Array.from(validStateStats.statesByCode.values()));
                        const pct = (count / (max || 1)) * 100;
                        return (
                          <div key={stateCode}>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-[#2a2a2a]">
                                {idx + 1}. {stateCode}
                              </span>
                              <span className="text-[#6b6b6b] tabular-nums">{count.toLocaleString()}</span>
                            </div>
                            <div className="mt-1 w-full h-[3px] rounded-full" style={{ background: '#ede5d2' }}>
                              <div className="h-[3px] rounded-full bg-[#c2410c]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="text-[#9a9a9a] text-center py-6 text-xs">no state data</div>
                )}
              </div>

              {/* Top cities */}
              <div className="bg-[#fdfaf2] border border-black/[0.08] p-4" style={{ borderRadius: 8 }}>
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-3">top cities</div>
                {(activeStats.by_city ?? []).length > 0 ? (
                  <div className="space-y-2">
                    {(() => {
                      const cities = (activeStats.by_city ?? []).slice(0, 6);
                      const max = Math.max(...cities.map((c: any) => c.count || 0), 1);
                      return cities.map((city: any, idx: number) => {
                        const pct = (city.count / max) * 100;
                        return (
                          <div key={`${city.city}-${city.state}`}>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-[#2a2a2a] truncate mr-2">
                                {idx + 1}. {(city.city || '—').toLowerCase()}, {city.state}
                              </span>
                              <span className="text-[#6b6b6b] flex-shrink-0 tabular-nums">{city.count.toLocaleString()}</span>
                            </div>
                            <div className="mt-1 w-full h-[3px] rounded-full" style={{ background: '#ede5d2' }}>
                              <div className="h-[3px] rounded-full bg-[#c2410c]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <div className="text-[#9a9a9a] text-center py-6 text-xs">no city data</div>
                )}
              </div>

              {/* Closest connections */}
              <div className="bg-[#fdfaf2] border border-black/[0.08] p-4" style={{ borderRadius: 8 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">closest connections</div>
                  {hasNetwork && networkCount > closestConnections.length && (
                    <button
                      onClick={() => setActiveTab('network')}
                      className="text-[10px] text-[#c2410c] hover:text-[#9a330a]"
                    >
                      view all {networkCount} →
                    </button>
                  )}
                </div>
                {closestConnections.length > 0 ? (
                  <div className="space-y-2">
                    {closestConnections.map(link => {
                      const initials = (link.other_actor_name ?? '?')
                        .split(/\s+/)
                        .map(p => p[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join('')
                        .toUpperCase();
                      return (
                        <button
                          key={link.other_actor_id}
                          onClick={() => navigateToActor(link.other_actor_id)}
                          className="w-full text-left flex items-center gap-2 hover:bg-[#f6f1e6] -mx-1 px-1 py-1 rounded transition-colors"
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              background: link.is_primary ? '#c2410c' : '#ede5d2',
                              color: link.is_primary ? '#fdfaf2' : '#6b6b6b',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 9,
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            {initials}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-[#1a1a1a] truncate">{link.other_actor_name}</div>
                            <div className="text-[10px] text-[#9a9a9a] truncate">
                              {link.other_actor_type?.toLowerCase() ?? '—'}
                              {link.relationship && ` · ${link.relationship.toLowerCase()}`}
                              {!link.relationship && link.role && ` · ${link.role.toLowerCase()}`}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[#9a9a9a] text-center py-6 text-xs">no connections on file</div>
                )}
              </div>
            </div>

            {/* ---- Recent activity preview ---- */}
            <div className="bg-[#fdfaf2] border border-black/[0.08] p-4 md:p-5" style={{ borderRadius: 8 }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">recent activity</div>
                {totalEvents > events.slice(0, 5).length && (
                  <button
                    onClick={() => setActiveTab('activity')}
                    className="text-[10px] text-[#c2410c] hover:text-[#9a330a]"
                  >
                    view all {totalEvents.toLocaleString()} →
                  </button>
                )}
              </div>
              {eventsLoading && events.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#6b6b6b]">
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-[#c2410c] border-t-transparent"></div>
                </div>
              ) : events.length === 0 ? (
                <div className="text-[#9a9a9a] text-center py-6 text-xs">no events on file</div>
              ) : (
                <div className="space-y-2">
                  {events.slice(0, 5).map(ev => (
                    <RecentEventRow key={ev.id} event={ev} />
                  ))}
                </div>
              )}
            </div>

            {/* ---- Details (extra metadata) ---- */}
            {extraMetadataFields.length > 0 && (
              <div className="bg-[#fdfaf2] border border-black/[0.08] p-4 md:p-5" style={{ borderRadius: 8 }}>
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-3">details</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                  {extraMetadataFields.map(field => (
                    <div key={field.key} className="border-l-2 border-black/10 pl-3">
                      <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">{field.label.toLowerCase()}</div>
                      <div className="text-[12px] text-[#1a1a1a] mt-0.5">{field.value as any}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Social profiles (kept) ---- */}
            {details?.social_profiles && details.social_profiles.length > 0 && (
              <div className="bg-[#fdfaf2] border border-black/[0.08] p-4 md:p-5" style={{ borderRadius: 8 }}>
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-3">social media profiles</div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
                  {details.social_profiles.map((profile, index) => (
                    <SocialProfile
                      key={`${profile.platform}-${profile.username}-${index}`}
                      platform={profile.platform}
                      username={profile.username}
                      url={profile.url}
                      bio={profile.bio}
                      followers={profile.followers}
                      verified={profile.verified}
                      profile_image={profile.profile_image}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'network' && isActor && (
          <NetworkTab
            actorId={entityId!}
            detailsRefresh={async () => {
              try {
                const [detailsData] = await Promise.all([analyticsClient.getEntityDetails(entityType as any, entityId!)]);
                setDetails(detailsData);
              } catch (e) {
                console.warn('Failed to refresh entity details after network edit');
              }
            }}
            renderReadOnly={() => (
              <>
                {renderNetworkSection(details.links_out || [], 'outgoing connections', 'out', navigateToActor)}
                {renderNetworkSection(details.links_in || [], 'incoming connections', 'in', navigateToActor)}
                {!hasNetwork && (
                  <div className="text-center py-8 text-[#9a9a9a] text-sm">no network relationships found</div>
                )}
              </>
            )}
          />
        )}

        {activeTab === 'activity' && (
          <div>
            <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">
                  activity · {(networkMode ? networkEvents.length : totalEvents).toLocaleString()} events
                </div>
                {networkActorIds.length > 0 && (
                  <div className="inline-flex bg-[#ede5d2] p-[3px]" style={{ borderRadius: 6 }}>
                    <button
                      onClick={() => setNetworkMode(false)}
                      className="text-[11px] px-2.5 py-1 transition-colors focus:outline-none"
                      style={{
                        background: !networkMode ? '#fdfaf2' : 'transparent',
                        color: !networkMode ? '#1a1a1a' : '#6b6b6b',
                        fontWeight: !networkMode ? 500 : 400,
                        borderRadius: 4,
                      }}
                    >
                      direct
                    </button>
                    <button
                      onClick={() => setNetworkMode(true)}
                      className="text-[11px] px-2.5 py-1 transition-colors focus:outline-none"
                      style={{
                        background: networkMode ? '#fdfaf2' : 'transparent',
                        color: networkMode ? '#1a1a1a' : '#6b6b6b',
                        fontWeight: networkMode ? 500 : 400,
                        borderRadius: 4,
                      }}
                    >
                      + network ({networkActorIds.length})
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={async () => {
                  setExporting(true);
                  try {
                    const data: any = await analyticsClient.exportEvents({
                      filters,
                      scope: 'entity',
                      scope_params: { entity_type: entityType, entity_id: entityId },
                    });

                    let header: string[] = [];
                    let dataRows: any[][] = [];
                    if (Array.isArray(data) && data.length > 0) {
                      if (typeof data[0] === 'object' && !Array.isArray(data[0])) {
                        const objRows = data as any[];
                        const maxPosts = objRows.reduce(
                          (m, r) => Math.max(m, Array.isArray(r.post_urls) ? r.post_urls.length : 0),
                          0,
                        );
                        header = [
                          'event_id',
                          'event_date',
                          'event_name',
                          'city',
                          'state',
                          'tags',
                          'actor_names',
                          ...Array.from({ length: maxPosts }, (_, i) => `post_url_${i + 1}`),
                        ];
                        dataRows = objRows.map(r => {
                          const base = [
                            r.event_id ?? '',
                            r.event_date ?? '',
                            r.event_name ?? '',
                            r.city ?? '',
                            r.state ?? '',
                            Array.isArray(r.tags) ? r.tags.join('|') : '',
                            Array.isArray(r.actor_names) ? r.actor_names.join('|') : '',
                          ];
                          const posts: string[] = Array.isArray(r.post_urls) ? r.post_urls : [];
                          const postCols = Array.from({ length: maxPosts }, (_, i) => posts[i] ?? '');
                          return [...base, ...postCols];
                        });
                      } else if (Array.isArray(data[0])) {
                        header = ['event_id', 'event_date', 'event_name', 'city', 'state', 'tags', 'actor_names', 'post_urls'];
                        dataRows = data as any[][];
                      }
                    } else {
                      header = ['event_id', 'event_date', 'event_name', 'city', 'state', 'tags', 'actor_names'];
                    }

                    const escapeCell = (cell: any) => {
                      const s = String(cell ?? '');
                      return s.includes(',') || s.includes('"') || s.includes('\n')
                        ? '"' + s.replace(/"/g, '""') + '"'
                        : s;
                    };
                    const csvLines = [header, ...dataRows].map(row => {
                      if (Array.isArray(row)) return row.map(escapeCell).join(',');
                      if (row && typeof row === 'object') return Object.values(row).map(escapeCell).join(',');
                      return escapeCell(row);
                    });
                    const csv = csvLines.join('\n');

                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${details.name.replace(/[^a-z0-9]/gi, '_')}_events.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => window.URL.revokeObjectURL(url), 0);
                  } catch (err) {
                    console.error('Export failed:', err);
                  } finally {
                    setExporting(false);
                  }
                }}
                disabled={exporting}
                className="px-2.5 py-1.5 text-[11px] font-medium text-[#2a2a2a] bg-[#fdfaf2] border border-black/[0.12] hover:bg-[#ede5d2] transition-colors flex items-center gap-1 disabled:opacity-50"
                style={{ minHeight: 30, borderRadius: 6 }}
              >
                <span>{exporting ? 'exporting…' : 'csv'}</span>
                {!exporting && <span aria-hidden>↓</span>}
              </button>
            </div>

            {networkMode ? (
              networkEventsLoading ? (
                <div className="flex items-center justify-center gap-3 py-10 text-sm text-[#6b6b6b]">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#c2410c] border-t-transparent" />
                  loading network events…
                </div>
              ) : networkEvents.length === 0 ? (
                <div className="text-center py-8 text-[#9a9a9a] text-sm">no network events found</div>
              ) : (
                <div className="space-y-2 md:space-y-2.5">
                  {networkEvents.map(event => (
                    <EventCard
                      key={event.id}
                      event={event}
                      isExpanded={expandedEvents.has(event.id)}
                      onToggleExpand={() => handleToggleExpand(event.id)}
                    />
                  ))}
                </div>
              )
            ) : events.length === 0 && !eventsLoading ? (
              <div className="text-center py-8 text-[#9a9a9a] text-sm">no events found</div>
            ) : (
              <div className="space-y-2 md:space-y-2.5">
                {events.map(event => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isExpanded={expandedEvents.has(event.id)}
                    onToggleExpand={() => handleToggleExpand(event.id)}
                  />
                ))}

                {hasMore && (
                  <div className="text-center pt-4">
                    <button
                      onClick={() => loadEvents()}
                      disabled={eventsLoading}
                      className="text-xs font-medium text-[#c2410c] hover:text-[#9a330a]"
                    >
                      {eventsLoading ? 'loading…' : 'load more events'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ---- helper subcomponents ----

const StatCell: React.FC<{
  label: string;
  value?: string;
  inlineSecondary?: string;
  hint?: string;
  trendValue?: 'increasing' | 'decreasing' | 'stable' | string | undefined;
  borderRight?: boolean;
  borderBottomMobile?: boolean;
}> = ({ label, value, inlineSecondary, hint, trendValue, borderRight, borderBottomMobile }) => {
  return (
    <div
      className={`px-4 py-3 ${borderRight ? 'md:border-r border-black/[0.08]' : ''} ${
        borderBottomMobile ? 'border-b md:border-b-0 border-black/[0.08]' : ''
      }`}
    >
      <div className="text-[9px] uppercase tracking-[0.4px] text-[#6b6b6b]">{label}</div>
      {trendValue !== undefined ? (
        <div
          className="mt-1 flex items-center gap-1"
          style={{
            color: trendValue === 'increasing' ? '#c2410c' : trendValue === 'decreasing' ? '#9a9a9a' : '#6b6b6b',
          }}
        >
          {trendValue === 'increasing' && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          )}
          {trendValue === 'decreasing' && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
            </svg>
          )}
          {trendValue === 'stable' && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
            </svg>
          )}
          <span className="text-[16px] font-medium">{trendValue ?? '—'}</span>
        </div>
      ) : (
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[22px] font-medium text-[#1a1a1a] tabular-nums leading-none">{value ?? '—'}</span>
          {inlineSecondary && <span className="text-[11px] text-[#6b6b6b]">{inlineSecondary}</span>}
        </div>
      )}
      {hint && <div className="text-[10px] text-[#9a9a9a] mt-1">{hint}</div>}
    </div>
  );
};

const RecentEventRow: React.FC<{ event: EventSummary }> = ({ event }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();

  const confidenceColor =
    event.confidence_score === undefined
      ? '#9a9a9a'
      : event.confidence_score >= 0.8
      ? '#c2410c'
      : event.confidence_score >= 0.6
      ? '#6b6b6b'
      : '#9a9a9a';

  return (
    <button
      onClick={() => navigate(`/entity/event/${event.id}`, { state: { from: location.pathname + location.search } })}
      className="w-full text-left bg-[#f6f1e6] border border-black/[0.06] hover:border-black/[0.15] transition-colors"
      style={{ borderRadius: 6, padding: '9px 12px' }}
    >
      <div className="text-[12px] text-[#1a1a1a] font-medium leading-snug truncate">{event.name}</div>
      <div className="text-[10px] text-[#6b6b6b] mt-0.5 flex items-center gap-2 flex-wrap">
        <span>{formatDate(event.date)}</span>
        <span className="text-[#9a9a9a]">·</span>
        <span>{event.city ? `${event.city}, ${event.state}` : `${event.state} · statewide`}</span>
        {event.confidence_score !== undefined && (
          <>
            <span className="text-[#9a9a9a]">·</span>
            <span style={{ color: confidenceColor }}>● {Math.round(event.confidence_score * 100)}%</span>
          </>
        )}
      </div>
    </button>
  );
};

// Free-standing helper (was a method on EntityView before — pulled out so it can be passed
// into NetworkTab.renderReadOnly without losing access to navigate)
const renderNetworkSection = (
  links: ActorLink[],
  title: string,
  direction: 'in' | 'out',
  navigateToActor: (id: string) => void,
) => {
  if (!links || links.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2 flex items-center gap-1.5">
        {title}
        <span className="text-[#9a9a9a] normal-case tracking-normal">({links.length})</span>
      </h3>
      <div className="space-y-1.5">
        {links.map((link, idx) => (
          <button
            key={`${direction}-${link.other_actor_id}-${idx}`}
            onClick={() => navigateToActor(link.other_actor_id)}
            className="w-full text-left bg-[#fdfaf2] border border-black/[0.08] hover:border-black/[0.2] transition-colors p-3"
            style={{ borderRadius: 6 }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-[#1a1a1a]">{link.other_actor_name}</span>
                  {link.is_primary && (
                    <span
                      className="text-[10px]"
                      style={{
                        padding: '1px 7px',
                        borderRadius: 10,
                        background: '#fdf2ed',
                        color: '#9a330a',
                        border: '0.5px solid rgba(194,65,12,0.2)',
                      }}
                    >
                      primary
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-[#6b6b6b]">
                  <span>{link.other_actor_type?.toLowerCase()}</span>
                  {(link.relationship || link.role) && (
                    <>
                      <span className="mx-1.5">·</span>
                      <span>{(link.relationship || link.role)?.toLowerCase()}</span>
                    </>
                  )}
                  {link.role_category && (
                    <>
                      <span className="mx-1.5">·</span>
                      <span>{link.role_category.toLowerCase()}</span>
                    </>
                  )}
                </div>
                {(link.start_date || link.end_date) && (
                  <div className="mt-0.5 text-[10px] text-[#9a9a9a]">
                    {link.start_date && `from ${link.start_date}`}
                    {link.start_date && link.end_date && ' · '}
                    {link.end_date && `to ${link.end_date}`}
                  </div>
                )}
              </div>
              <svg className="w-4 h-4 text-[#9a9a9a] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const ActorProfileSection: React.FC<{ actorId: string; onDone?: () => void }> = ({ actorId, onDone }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [usernames, setUsernames] = useState<ActorUsername[]>([]);
  const [relationships, setRelationships] = useState<ActorRelationship[]>([]);
  const [inboundRelationships, setInboundRelationships] = useState<ActorRelationship[]>([]);
  const [members, setMembers] = useState<ActorMember[]>([]);

  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    name: '',
    actor_type: '',
    city: '',
    state: '',
    region: '',
    about: '',
    should_scrape: false,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<StatusMessage>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [relationshipDrafts, setRelationshipDrafts] = useState<RelationshipDraftMap>({});
  const [relationshipSavingKey, setRelationshipSavingKey] = useState<string | null>(null);
  const [relationshipDeletingKey, setRelationshipDeletingKey] = useState<string | null>(null);
  const [relationshipErrors, setRelationshipErrors] = useState<Record<string, string>>({});
  const [relationshipGlobalError, setRelationshipGlobalError] = useState<string | null>(null);
  const [relationshipSuccessKey, setRelationshipSuccessKey] = useState<string | null>(null);

  const [newLinkSearch, setNewLinkSearch] = useState('');
  const [newLinkResults, setNewLinkResults] = useState<Actor[]>([]);
  const [newLinkError, setNewLinkError] = useState<string | null>(null);
  const [selectedNewLink, setSelectedNewLink] = useState<Actor | null>(null);
  const [newLinkRelationship, setNewLinkRelationship] = useState('');
  const [newLinkRole, setNewLinkRole] = useState('');
  const [isSearchingLinks, setIsSearchingLinks] = useState(false);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const searchTimeoutRef = useRef<number | undefined>(undefined);

  const loadActorData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, usernamesData, relationshipsData, inboundData, membersData] = await Promise.all([
        fetchActorDetails(actorId),
        fetchActorUsernames(actorId),
        fetchActorRelationships(actorId),
        fetchActorInboundRelationships(actorId),
        fetchActorMembers(actorId),
      ]);

      setActor(detail ?? null);
      setUsernames(usernamesData);
      setRelationships(relationshipsData);
      setInboundRelationships(inboundData);
      setMembers(membersData);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load actor details'));
      console.error('Failed to load actor data', err);
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => {
    loadActorData();
    return () => {
      if (searchTimeoutRef.current) {
        window.clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [loadActorData]);

  useEffect(() => {
    if (actor) {
      setProfileForm({
        name: actor.name ?? '',
        actor_type: actor.actor_type ?? '',
        city: actor.city ?? '',
        state: actor.state ?? '',
        region: actor.region ?? '',
        about: actor.about ?? '',
        should_scrape: Boolean(actor.should_scrape ?? false),
      });
    }
  }, [actor]);

  useEffect(() => {
    const drafts: RelationshipDraftMap = {};
    relationships.forEach(rel => {
      drafts[relationshipKey(rel)] = {
        relationship: rel.relationship ?? '',
        role: rel.role ?? '',
      };
    });
    inboundRelationships.forEach(rel => {
      drafts[relationshipKey(rel)] = {
        relationship: rel.relationship ?? '',
        role: rel.role ?? '',
      };
    });
    setRelationshipDrafts(drafts);
    setRelationshipErrors({});
  }, [relationships, inboundRelationships]);

  useEffect(() => {
    if (!isEditing) {
      if (searchTimeoutRef.current) {
        window.clearTimeout(searchTimeoutRef.current);
      }
      setIsSearchingLinks(false);
      setNewLinkResults([]);
      return;
    }

    if (!actor) {
      setNewLinkResults([]);
      return;
    }

    const term = newLinkSearch.trim();
    if (term.length < 2) {
      setNewLinkResults([]);
      setIsSearchingLinks(false);
      return;
    }

    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    setIsSearchingLinks(true);
    setNewLinkError(null);

    searchTimeoutRef.current = window.setTimeout(async () => {
      try {
        const results = await searchActorsForLinking(term, 12, actor.id);
        const existing = new Set(relationships.map(rel => rel.to_actor_id));
        setNewLinkResults(results.filter(candidate => !existing.has(candidate.id)));
      } catch (err) {
        setNewLinkError(errorMessage(err, 'Failed to search actors'));
      } finally {
        setIsSearchingLinks(false);
      }
    }, 250);

    return () => {
      if (searchTimeoutRef.current) {
        window.clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [actor, isEditing, newLinkSearch, relationships]);

  const profileDirty = useMemo(() => {
    if (!actor) return false;
    return (
      normalizeText(profileForm.name) !== normalizeText(actor.name) ||
      normalizeText(profileForm.actor_type) !== normalizeText(actor.actor_type) ||
      normalizeText(profileForm.city) !== normalizeText(actor.city) ||
      normalizeText(profileForm.state) !== normalizeText(actor.state) ||
      normalizeText(profileForm.region) !== normalizeText(actor.region) ||
      normalizeText(profileForm.about) !== normalizeText(actor.about) ||
      profileForm.should_scrape !== Boolean(actor.should_scrape ?? false)
    );
  }, [actor, profileForm]);

  const refreshRelationships = useCallback(async () => {
    if (!actor) return;
    try {
      const [nextRelationships, nextInbound, nextMembers] = await Promise.all([
        fetchActorRelationships(actor.id),
        fetchActorInboundRelationships(actor.id),
        fetchActorMembers(actor.id),
      ]);
      setRelationships(nextRelationships);
      setInboundRelationships(nextInbound);
      setMembers(nextMembers);
    } catch (err) {
      setRelationshipGlobalError(errorMessage(err, 'Failed to refresh relationships'));
    }
  }, [actor]);

  const handleProfileChange = useCallback(
    (field: keyof ProfileFormState, value: string | boolean) => {
      setProfileForm(prev => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const handleProfileSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!actor || !profileDirty) return;

    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const updated = await updateActorDetails(actor.id, {
        name: normalizeText(profileForm.name) || null,
        actor_type: normalizeText(profileForm.actor_type) || null,
        city: normalizeText(profileForm.city) || null,
        state: normalizeText(profileForm.state) || null,
        region: normalizeText(profileForm.region) || null,
        about: normalizeText(profileForm.about) || null,
        should_scrape: profileForm.should_scrape,
      });
      setActor(updated);
      setProfileStatus({ type: 'success', text: 'Changes saved' });
      window.setTimeout(() => setProfileStatus(null), 2000);
    } catch (err) {
      setProfileStatus({ type: 'error', text: errorMessage(err, 'Failed to update actor') });
    } finally {
      setProfileSaving(false);
    }
  };

  const _updateRelationshipDraft = useCallback(
    (key: string, field: 'relationship' | 'role', value: string) => {
      setRelationshipDrafts(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? { relationship: '', role: '' }),
          [field]: value,
        },
      }));
    },
    [],
  );

  const _handleSaveRelationship = async (rel: ActorRelationship) => {
    if (!actor) return;
    const key = relationshipKey(rel);
    const draft = relationshipDrafts[key];
    if (!draft || !isEditing) return;

    if (
      normalizeText(draft.relationship) === normalizeText(rel.relationship) &&
      normalizeText(draft.role) === normalizeText(rel.role)
    ) {
      return;
    }

    setRelationshipSavingKey(key);
    setRelationshipErrors(prev => ({ ...prev, [key]: '' }));

    try {
      await updateActorRelationship(
        {
          from_actor_id: rel.from_actor_id,
          to_actor_id: rel.to_actor_id,
          original_relationship: rel.relationship ?? null,
          original_role: rel.role ?? null,
          created_at: rel.created_at ?? null,
        },
        {
          relationship: normalizeText(draft.relationship) || null,
          role: normalizeText(draft.role) || null,
        },
      );
      await refreshRelationships();
      setRelationshipSuccessKey(key);
      window.setTimeout(() => setRelationshipSuccessKey(null), 1500);
    } catch (err) {
      setRelationshipErrors(prev => ({
        ...prev,
        [key]: errorMessage(err, 'Failed to update relationship'),
      }));
    } finally {
      setRelationshipSavingKey(null);
    }
  };

  const _handleDeleteRelationship = async (rel: ActorRelationship) => {
    if (!actor) return;
    const key = relationshipKey(rel);
    setRelationshipDeletingKey(key);
    setRelationshipErrors(prev => ({ ...prev, [key]: '' }));

    try {
      await deleteActorRelationship({
        from_actor_id: rel.from_actor_id,
        to_actor_id: rel.to_actor_id,
        original_relationship: rel.relationship ?? null,
        original_role: rel.role ?? null,
        created_at: rel.created_at ?? null,
      });
      await refreshRelationships();
    } catch (err) {
      setRelationshipErrors(prev => ({
        ...prev,
        [key]: errorMessage(err, 'Failed to remove relationship'),
      }));
    } finally {
      setRelationshipDeletingKey(null);
    }
  };

  const _handleCreateRelationship = async () => {
    if (!actor) return;
    if (!selectedNewLink) {
      setNewLinkError('Choose an actor to link');
      return;
    }

    setIsCreatingLink(true);
    setNewLinkError(null);

    try {
      await createActorRelationship({
        from_actor_id: actor.id,
        to_actor_id: selectedNewLink.id,
        relationship: normalizeText(newLinkRelationship) || null,
        role: normalizeText(newLinkRole) || null,
      });
      await refreshRelationships();
      setSelectedNewLink(null);
      setNewLinkRelationship('');
      setNewLinkRole('');
      setNewLinkSearch('');
      setNewLinkResults([]);
    } catch (err) {
      setNewLinkError(errorMessage(err, 'Failed to add relationship'));
    } finally {
      setIsCreatingLink(false);
    }
  };

  const toggleEditing = () => {
    setIsEditing(prev => {
      const next = !prev;
      if (!next) {
        setProfileStatus(null);
        setRelationshipGlobalError(null);
        setRelationshipErrors({});
        setRelationshipSuccessKey(null);
        setSelectedNewLink(null);
        setNewLinkSearch('');
        setNewLinkResults([]);
        if (actor) {
          setProfileForm({
            name: actor.name ?? '',
            actor_type: actor.actor_type ?? '',
            city: actor.city ?? '',
            state: actor.state ?? '',
            region: actor.region ?? '',
            about: actor.about ?? '',
            should_scrape: Boolean(actor.should_scrape ?? false),
          });
          const drafts: RelationshipDraftMap = {};
          relationships.forEach(rel => {
            drafts[relationshipKey(rel)] = {
              relationship: rel.relationship ?? '',
              role: rel.role ?? '',
            };
          });
          inboundRelationships.forEach(rel => {
            drafts[relationshipKey(rel)] = {
              relationship: rel.relationship ?? '',
              role: rel.role ?? '',
            };
          });
          setRelationshipDrafts(drafts);
        }
      }
      return next;
    });
  };

  const _relationshipList = relationships;
  const membersPreview = useMemo(() => members.slice(0, 12), [members]);
  const profileMessage = profileStatus?.text ?? '';

  return (
    <section className="rounded-2xl border border-black/10 bg-[#fdfaf2] p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9a9a9a]">Actor Profile</h2>
          {actor && (
            <p className="mt-1 text-lg font-semibold text-[#1a1a1a]">{actor.name ?? 'Unnamed Actor'}</p>
          )}
          {actor && (
            <p className="text-sm text-[#9a9a9a]">
              <span className="uppercase">{actor.actor_type ?? 'Unknown type'}</span>
              {(actor.city || actor.state) && (
                <>
                  <span className="mx-2 text-gray-300">•</span>
                  <span>{[actor.city, actor.state].filter(Boolean).join(', ')}</span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!loading && !error && (
            <button
              type="button"
              onClick={toggleEditing}
              className={`inline-flex items-center rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium transition ${
                isEditing ? 'bg-[#c2410c] text-white border-[#c2410c]' : 'bg-[#f6f1e6] text-[#6b6b6b] hover:bg-[#ede5d2]'
              }`}
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {isEditing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-[#9a9a9a]">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#c2410c] border-t-transparent" />
            <span className="ml-3">Loading profile…</span>
          </div>
        ) : error ? (
          <div className="rounded-md border border-[#DC2626]/20 bg-[#FEE2E2]/30 px-4 py-3 text-sm text-[#DC2626]">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={loadActorData}
                className="ml-4 rounded border border-[#DC2626]/30 px-2 py-1 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2]/40"
              >
                Retry
              </button>
            </div>
          </div>
        ) : actor ? (
          <>
            {isEditing ? (
              <form className="space-y-6" onSubmit={handleProfileSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm text-[#6b6b6b]">
                    <span className="font-medium text-[#2a2a2a]">Name</span>
                    <input
                      value={profileForm.name}
                      onChange={event => handleProfileChange('name', event.target.value)}
                      className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                      placeholder="Actor name"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-[#6b6b6b]">
                    <span className="font-medium text-[#2a2a2a]">Type</span>
                    <select
                      value={profileForm.actor_type}
                      onChange={event => handleProfileChange('actor_type', event.target.value)}
                      className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                    >
                      <option value="">Select type</option>
                      {ACTOR_TYPE_OPTIONS.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm text-[#6b6b6b]">
                    <span className="font-medium text-[#2a2a2a]">City</span>
                    <input
                      value={profileForm.city}
                      onChange={event => handleProfileChange('city', event.target.value)}
                      className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                      placeholder="Phoenix"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-[#6b6b6b]">
                    <span className="font-medium text-[#2a2a2a]">State</span>
                    <input
                      value={profileForm.state}
                      onChange={event => handleProfileChange('state', event.target.value)}
                      className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                      placeholder="AZ"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-[#6b6b6b]">
                    <span className="font-medium text-[#2a2a2a]">Region</span>
                    <input
                      value={profileForm.region}
                      onChange={event => handleProfileChange('region', event.target.value)}
                      className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                      placeholder="Maricopa County"
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-black/10 bg-[#f6f1e6] px-3 py-2 text-sm text-[#6b6b6b]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-black/15 text-[#c2410c] focus:ring-[#c2410c]/10"
                      checked={profileForm.should_scrape}
                      onChange={event => handleProfileChange('should_scrape', event.target.checked)}
                    />
                    <span className="font-medium text-[#2a2a2a]">Eligible for scraping</span>
                  </label>
                </div>
                <label className="space-y-1 text-sm text-[#6b6b6b]">
                  <span className="font-medium text-[#2a2a2a]">About</span>
                  <textarea
                    value={profileForm.about}
                    onChange={event => handleProfileChange('about', event.target.value)}
                    rows={5}
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                    placeholder="Summary, biography, notes"
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-medium">
                    {profileStatus?.type === 'error' && <span className="text-[#DC2626]">{profileMessage}</span>}
                    {profileStatus?.type === 'success' && <span className="text-emerald-600">{profileMessage}</span>}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={toggleEditing}
                      className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-[#6b6b6b] hover:border-black/15"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!profileDirty || profileSaving}
                      className="rounded-lg bg-[#c2410c] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9a330a] disabled:cursor-not-allowed disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {profileSaving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 text-sm text-[#6b6b6b]">
                    <div>
                      <span className="text-xs uppercase text-[#9a9a9a]">Type</span>
                      <div className="font-medium text-[#1a1a1a]">{actor.actor_type ?? '—'}</div>
                    </div>
                    <div>
                      <span className="text-xs uppercase text-[#9a9a9a]">Location</span>
                      <div className="font-medium text-[#1a1a1a]">{[actor.city, actor.state].filter(Boolean).join(', ') || '—'}</div>
                    </div>
                    <div>
                      <span className="text-xs uppercase text-[#9a9a9a]">Region</span>
                      <div className="font-medium text-[#1a1a1a]">{actor.region ?? '—'}</div>
                    </div>
                    <div>
                      <span className="text-xs uppercase text-[#9a9a9a]">About</span>
                      <p className="mt-1 text-[#2a2a2a]">{actor.about?.trim() || 'No description available.'}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Social Handles</h3>
                    {usernames.length === 0 ? (
                      <p className="mt-2 text-sm text-[#9a9a9a]">No handles linked.</p>
                    ) : (
                      <ul className="mt-3 space-y-2 text-sm">
                        {usernames.map(handle => (
                          <li key={handle.id} className="flex items-center justify-between rounded-md border border-black/10 bg-[#f6f1e6] px-3 py-2">
                            <span className="font-medium text-[#1a1a1a]">@{handle.username}</span>
                            <span className="text-xs uppercase tracking-wide text-[#9a9a9a]">{handle.platform}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {membersPreview.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Members</h3>
                    <ul className="mt-3 space-y-2 text-sm text-[#6b6b6b]">
                      {membersPreview.map(member => (
                        <li key={member.id} className="rounded-md border border-black/10 bg-[#f6f1e6] px-3 py-2">
                          <div className="text-[#1a1a1a]">{member.member_actor?.name ?? member.member_actor_id}</div>
                          <div className="text-xs text-[#9a9a9a]">{member.role ?? 'Member'}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-[#9a9a9a]">Actor not found.</div>
        )}
      </div>
    </section>
  );
};

// Network tab with edit mode to add/remove inbound or outbound connections
const NetworkTab: React.FC<{
  actorId: string;
  detailsRefresh: () => Promise<void>;
  renderReadOnly: () => React.ReactNode;
}> = ({ actorId, detailsRefresh, renderReadOnly }) => {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outbound, setOutbound] = useState<ActorRelationship[]>([]);
  const [inbound, setInbound] = useState<ActorRelationship[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<RelationshipDraftMap>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [successKey, setSuccessKey] = useState<string | null>(null);

  // Add connection state
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Actor[]>([]);
  const [selected, setSelected] = useState<Actor | null>(null);
  const [relType, setRelType] = useState('');
  const [role, setRole] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const searchRef = useRef<number | undefined>(undefined);

  const loadNetwork = useCallback(async () => {
    setLoading(true);
    setGlobalError(null);
    try {
      const [outR, inR] = await Promise.all([
        fetchActorRelationships(actorId),
        fetchActorInboundRelationships(actorId),
      ]);
      setOutbound(outR);
      setInbound(inR);
    } catch (e) {
      setGlobalError(errorMessage(e, 'Failed to load network'));
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => {
    if (editing) {
      loadNetwork();
    }
    return () => {
      if (searchRef.current) window.clearTimeout(searchRef.current);
    };
  }, [editing, loadNetwork]);

  // Seed drafts from loaded links
  useEffect(() => {
    if (!editing) return;
    const d: RelationshipDraftMap = {};
    outbound.forEach(r => (d[relationshipKey(r)] = { relationship: r.relationship ?? '', role: r.role ?? '' }));
    inbound.forEach(r => (d[relationshipKey(r)] = { relationship: r.relationship ?? '', role: r.role ?? '' }));
    setDrafts(d);
    setRowErrors({});
  }, [editing, outbound, inbound]);

  useEffect(() => {
    if (!editing) return;
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    if (searchRef.current) window.clearTimeout(searchRef.current);
    setIsSearching(true);
    setAddError(null);
    searchRef.current = window.setTimeout(async () => {
      try {
        const r = await searchActorsForLinking(q, 12, actorId);
        const existing = new Set(
          (direction === 'outbound' ? outbound : inbound).map(x =>
            direction === 'outbound' ? x.to_actor_id : x.from_actor_id,
          ),
        );
        setResults(r.filter(a => !existing.has(a.id)));
      } catch (e) {
        setAddError(errorMessage(e, 'Search failed'));
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => {
      if (searchRef.current) window.clearTimeout(searchRef.current);
    };
  }, [term, editing, direction, actorId, outbound, inbound]);

  const handleCreate = async () => {
    if (!selected) {
      setAddError('Select an actor');
      return;
    }
    setIsCreating(true);
    setAddError(null);
    try {
      if (direction === 'outbound') {
        await createActorRelationship({
          from_actor_id: actorId,
          to_actor_id: selected.id,
          relationship: normalizeText(relType) || null,
          role: normalizeText(role) || null,
        });
      } else {
        await createActorRelationship({
          from_actor_id: selected.id,
          to_actor_id: actorId,
          relationship: normalizeText(relType) || null,
          role: normalizeText(role) || null,
        });
      }
      await loadNetwork();
      await detailsRefresh();
      setSelected(null);
      setTerm('');
      setResults([]);
      setRelType('');
      setRole('');
    } catch (e) {
      setAddError(errorMessage(e, 'Failed to create link'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemove = async (rel: ActorRelationship, _inboundSide: boolean) => {
    const key = relationshipKey(rel);
    try {
      setDeletingKey(key);
      await deleteActorRelationship({
        from_actor_id: rel.from_actor_id,
        to_actor_id: rel.to_actor_id,
        original_relationship: rel.relationship ?? null,
        original_role: rel.role ?? null,
        created_at: rel.created_at ?? null,
      });
      await loadNetwork();
      await detailsRefresh();
    } catch (e) {
      setGlobalError(errorMessage(e, 'Failed to remove link'));
    } finally {
      setDeletingKey(null);
    }
  };

  const updateDraft = useCallback((key: string, field: 'relationship' | 'role', value: string) => {
    setDrafts(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? { relationship: '', role: '' }), [field]: value },
    }));
  }, []);

  const handleSave = async (rel: ActorRelationship) => {
    const key = relationshipKey(rel);
    const draft = drafts[key];
    if (!draft) return;
    if (
      normalizeText(draft.relationship) === normalizeText(rel.relationship) &&
      normalizeText(draft.role) === normalizeText(rel.role)
    ) {
      return;
    }
    setSavingKey(key);
    setRowErrors(prev => ({ ...prev, [key]: '' }));
    try {
      await updateActorRelationship(
        {
          from_actor_id: rel.from_actor_id,
          to_actor_id: rel.to_actor_id,
          original_relationship: rel.relationship ?? null,
          original_role: rel.role ?? null,
          created_at: rel.created_at ?? null,
        },
        {
          relationship: normalizeText(draft.relationship) || null,
          role: normalizeText(draft.role) || null,
        },
      );
      await loadNetwork();
      await detailsRefresh();
      setSuccessKey(key);
      window.setTimeout(() => setSuccessKey(null), 1500);
    } catch (e) {
      setRowErrors(prev => ({ ...prev, [key]: errorMessage(e, 'Failed to update link') }));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base md:text-lg font-semibold">Network</h3>
        <button
          type="button"
          onClick={() => setEditing(v => !v)}
          className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            editing ? 'bg-[#c2410c] text-white border-[#c2410c]' : 'bg-[#f6f1e6] text-[#6b6b6b] border-black/10 hover:bg-[#ede5d2]'
          }`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {!editing ? (
        <>{renderReadOnly()}</>
      ) : (
        <div className="space-y-6">
          {globalError && (
            <div className="rounded-md border border-[#DC2626]/20 bg-[#FEE2E2]/30 px-3 py-2 text-sm text-[#DC2626]">{globalError}</div>
          )}

          <div className="rounded-lg border border-black/10 bg-[#f6f1e6] p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Add Connection</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
              <div>
                <div className="mb-2 flex items-center gap-3 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" checked={direction === 'outbound'} onChange={() => setDirection('outbound')} />
                    <span>Outbound (from this actor)</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" checked={direction === 'inbound'} onChange={() => setDirection('inbound')} />
                    <span>Inbound (to this actor)</span>
                  </label>
                </div>
                <label className="space-y-1 text-sm text-[#6b6b6b]">
                  <span className="font-medium text-[#2a2a2a]">Search actors</span>
                  <input
                    value={term}
                    onChange={e => {
                      setTerm(e.target.value);
                      setSelected(null);
                    }}
                    placeholder="Search by name, city, or state"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                  />
                </label>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-black/10 bg-[#fdfaf2]">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-6 text-sm text-[#9a9a9a]">Searching…</div>
                  ) : results.length === 0 ? (
                    <div className="py-5 text-center text-xs text-[#9a9a9a]">
                      {term.trim().length < 2 ? 'Type at least two characters to search' : 'No actors found'}
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-100 text-sm">
                      {results.map(opt => {
                        const sel = selected?.id === opt.id;
                        return (
                          <li key={opt.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected(opt);
                                setTerm(opt.name ?? '');
                              }}
                              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition ${
                                sel ? 'bg-blue-50 text-[#9a330a]' : 'hover:bg-[#f6f1e6]'
                              }`}
                            >
                              <span className="font-medium">{opt.name ?? 'Unnamed actor'}</span>
                              <span className="text-xs text-[#9a9a9a]">
                                {opt.actor_type?.toUpperCase() ?? '—'}
                                {(opt.city || opt.state) && ` • ${[opt.city, opt.state].filter(Boolean).join(', ')}`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <label className="space-y-1 text-sm text-[#6b6b6b]">
                  <span className="font-medium text-[#2a2a2a]">Relationship</span>
                  <input
                    value={relType}
                    onChange={e => setRelType(e.target.value)}
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                    placeholder="member, staff, etc."
                  />
                </label>
                <label className="space-y-1 text-sm text-[#6b6b6b]">
                  <span className="font-medium text-[#2a2a2a]">Role</span>
                  <input
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                    placeholder="Organizer"
                  />
                </label>
                {addError && <p className="text-xs font-medium text-[#DC2626]">{addError}</p>}
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isCreating || !selected}
                  className="w-full rounded-lg bg-[#c2410c] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9a330a] disabled:cursor-not-allowed disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? 'Linking…' : selected ? `Link ${selected.name ?? 'Actor'}` : 'Select an actor to link'}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-black/10 bg-[#fdfaf2] p-4">
              <header className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Outbound</h4>
                <span className="text-xs text-[#9a9a9a]">{outbound.length}</span>
              </header>
              {loading ? (
                <div className="text-center text-sm text-[#9a9a9a] py-4">Loading…</div>
              ) : outbound.length === 0 ? (
                <div className="text-center text-sm text-[#9a9a9a] py-4">No outbound links</div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {outbound.map(rel => {
                    const key = relationshipKey(rel);
                    const draft = drafts[key] ?? { relationship: rel.relationship ?? '', role: rel.role ?? '' };
                    const isSaving = savingKey === key;
                    const isDeleting = deletingKey === key;
                    const err = rowErrors[key];
                    const saved = successKey === key;
                    return (
                      <li key={key} className="rounded-md border border-black/10 bg-[#f6f1e6] px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-[#1a1a1a]">{rel.to_actor?.name ?? rel.to_actor_id}</div>
                            <div className="text-xs text-[#9a9a9a]">
                              {rel.to_actor?.actor_type?.toUpperCase() ?? '—'}
                              {(rel.to_actor?.city || rel.to_actor?.state) &&
                                ` • ${[rel.to_actor?.city, rel.to_actor?.state].filter(Boolean).join(', ')}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemove(rel, false)}
                            disabled={isDeleting || isSaving}
                            className="rounded border border-[#DC2626]/20 px-2 py-1 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2]/30 disabled:opacity-60"
                          >
                            {isDeleting ? 'Removing…' : 'Remove'}
                          </button>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <label className="space-y-1 text-xs text-[#6b6b6b]">
                            <span className="font-medium text-[#2a2a2a]">Relationship</span>
                            <input
                              value={draft.relationship}
                              onChange={e => updateDraft(key, 'relationship', e.target.value)}
                              className="w-full rounded border border-black/10 px-2 py-1.5 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                              placeholder="member"
                            />
                          </label>
                          <label className="space-y-1 text-xs text-[#6b6b6b]">
                            <span className="font-medium text-[#2a2a2a]">Role</span>
                            <input
                              value={draft.role}
                              onChange={e => updateDraft(key, 'role', e.target.value)}
                              className="w-full rounded border border-black/10 px-2 py-1.5 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                              placeholder="Organizer"
                            />
                          </label>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <div className="font-medium">
                            {err && <span className="text-[#DC2626]">{err}</span>}
                            {saved && !err && <span className="text-emerald-600">Saved</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSave(rel)}
                            disabled={isSaving || isDeleting}
                            className="rounded bg-[#c2410c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9a330a] disabled:opacity-60"
                          >
                            {isSaving ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-black/10 bg-[#fdfaf2] p-4">
              <header className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Inbound</h4>
                <span className="text-xs text-[#9a9a9a]">{inbound.length}</span>
              </header>
              {loading ? (
                <div className="text-center text-sm text-[#9a9a9a] py-4">Loading…</div>
              ) : inbound.length === 0 ? (
                <div className="text-center text-sm text-[#9a9a9a] py-4">No inbound links</div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {inbound.map(rel => {
                    const key = relationshipKey(rel);
                    const draft = drafts[key] ?? { relationship: rel.relationship ?? '', role: rel.role ?? '' };
                    const isSaving = savingKey === key;
                    const isDeleting = deletingKey === key;
                    const err = rowErrors[key];
                    const saved = successKey === key;
                    return (
                      <li key={`in-${key}`} className="rounded-md border border-black/10 bg-[#f6f1e6] px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-[#1a1a1a]">{rel.to_actor?.name ?? rel.from_actor_id}</div>
                            <div className="text-xs text-[#9a9a9a]">
                              {rel.to_actor?.actor_type?.toUpperCase() ?? '—'}
                              {(rel.to_actor?.city || rel.to_actor?.state) &&
                                ` • ${[rel.to_actor?.city, rel.to_actor?.state].filter(Boolean).join(', ')}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemove(rel, true)}
                            disabled={isDeleting || isSaving}
                            className="rounded border border-[#DC2626]/20 px-2 py-1 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2]/30 disabled:opacity-60"
                          >
                            {isDeleting ? 'Removing…' : 'Remove'}
                          </button>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <label className="space-y-1 text-xs text-[#6b6b6b]">
                            <span className="font-medium text-[#2a2a2a]">Relationship</span>
                            <input
                              value={draft.relationship}
                              onChange={e => updateDraft(key, 'relationship', e.target.value)}
                              className="w-full rounded border border-black/10 px-2 py-1.5 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                              placeholder="member"
                            />
                          </label>
                          <label className="space-y-1 text-xs text-[#6b6b6b]">
                            <span className="font-medium text-[#2a2a2a]">Role</span>
                            <input
                              value={draft.role}
                              onChange={e => updateDraft(key, 'role', e.target.value)}
                              className="w-full rounded border border-black/10 px-2 py-1.5 text-sm text-[#1a1a1a] focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#c2410c]/10"
                              placeholder="Organizer"
                            />
                          </label>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <div className="font-medium">
                            {err && <span className="text-[#DC2626]">{err}</span>}
                            {saved && !err && <span className="text-emerald-600">Saved</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSave(rel)}
                            disabled={isSaving || isDeleting}
                            className="rounded bg-[#c2410c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9a330a] disabled:opacity-60"
                          >
                            {isSaving ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
