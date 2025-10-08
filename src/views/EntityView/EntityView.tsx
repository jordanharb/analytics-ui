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
  fetchActorUsernames,
  updateActorDetails,
  searchActorsForLinking,
  createActorRelationship,
  deleteActorRelationship,
  updateActorRelationship,
} from '../../api/actorsDirectoryService';
import type { Actor, ActorMember, ActorRelationship, ActorUsername } from '../../types/actorsDirectory';

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
  const [timeseriesPeriod, setTimeseriesPeriod] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);

  // Calculate valid state count, handling duplicates and invalid entries
  // Must be called before any conditional returns to follow React hooks rules
  const validStateStats = useMemo(() => {
    if (!stats?.by_state) return { validCount: 0, statesByCode: new Map() };
    return getUniqueValidStates(stats.by_state);
  }, [stats]);
  
  // Get ordered metadata fields for display
  // Must be called before any conditional returns to follow React hooks rules
  const metadataFields = useMemo(() => {
    if (!details?.metadata) return [];
    return getOrderedMetadataFields(details.metadata);
  }, [details?.metadata]);

  const extraMetadataFields = useMemo(() => {
    return metadataFields.filter(field => !['About', 'Type', 'City', 'State'].includes(field.label));
  }, [metadataFields]);

  // Load entity details
  useEffect(() => {
    if (!entityType || !entityId) return;
    
    const loadDetails = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // For entity details, just get base entity info (no filtering)
        // For stats and timeseries, only apply the selected time period
        const entityOnlyFilters = { 
          period: timeseriesPeriod 
        };
        
        const [detailsData, statsData, timeseriesData] = await Promise.all([
          analyticsClient.getEntityDetails(entityType as any, entityId),
          analyticsClient.getEntityStats(entityType as any, entityId, entityOnlyFilters),
          analyticsClient.getEntityTimeseries(entityType as any, entityId, entityOnlyFilters, timeseriesPeriod)
        ]);
        
        setDetails(detailsData);
        setStats(statsData);
        setTimeseries(timeseriesData);
      } catch (err: any) {
        setError(err.message || 'Failed to load entity details');
        console.error('Error loading entity:', err);
      } finally {
        setLoading(false);
      }
    };
    
    loadDetails();
  }, [entityType, entityId, timeseriesPeriod]); // Only reload when entity or timeframe change

  // Load events
  const loadEvents = useCallback(async (isInitial = false) => {
    if (!entityType || !entityId || eventsLoading) return;
    
    setEventsLoading(true);
    
    try {
      // Use global filters but with all-time period for entity events
      const entityFilters = { 
        ...filters,
        period: 'all' as const 
      };
      
      const response = await analyticsClient.getEntityEvents(
        entityType as any,
        entityId,
        entityFilters,
        50,
        isInitial ? undefined : cursor
      );
      
      // Dedupe and sort events chronologically (newest first)
      const newEvents = isInitial ? response.events : [...events, ...response.events];
      const uniqueEvents = Array.from(
        new Map(newEvents.map(e => [e.id, e])).values()
      ).sort((a, b) => {
        // Sort by date descending (newest first)
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
  }, [entityType, entityId, cursor, events, eventsLoading, filters]); // Include filters in dependencies

  // Initial events load and reload when filters change
  useEffect(() => {
    loadEvents(true);
  }, [entityType, entityId, filters]); // Reload when filters change

  const handleToggleExpand = (eventId: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const navigateToActor = (actorId: string) => {
    navigate(`/entity/actor/${actorId}`);
  };

  // Load timeseries data for different periods
  const loadTimeseries = useCallback(async (period: 'week' | 'month' | 'year' | 'all') => {
    if (!entityType || !entityId || timeseriesLoading) return;
    
    setTimeseriesLoading(true);
    setTimeseriesPeriod(period);
    
    // Determine granularity based on period
    let granularity: 'day' | 'week' | 'month' | 'year' | 'auto';
    switch(period) {
      case 'week':
        granularity = 'day';  // 7 days → daily points
        break;
      case 'month':
        granularity = 'day';  // 30 days → daily points
        break;
      case 'year':
        granularity = 'week';  // 1 year → weekly points
        break;
      case 'all':
        granularity = 'week';  // all time → bi-weekly (weekly points)
        break;
      default:
        granularity = 'auto';
    }
    
    try {
      // Use independent filters for timeseries based on selected period
      const timeseriesFilters = { period };
      
      const data = await analyticsClient.getEntityTimeseries(
        entityType as any,
        entityId,
        timeseriesFilters,
        period,
        granularity
      );
      console.log('Loaded timeseries data:', data);
      setTimeseries(data);
    } catch (err: any) {
      console.error('Error loading timeseries:', err);
      // Set empty data on error to show "No activity data"
      setTimeseries(null);
    } finally {
      setTimeseriesLoading(false);
    }
  }, [entityType, entityId, filters, timeseriesLoading]);

  const renderNetworkSection = (links: ActorLink[], title: string, direction: 'in' | 'out') => {
    if (!links || links.length === 0) return null;
    
    return (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3 flex items-center">
          {title}
          <span className="ml-2 text-sm text-gray-500 font-normal">({links.length})</span>
        </h3>
        <div className="space-y-2">
          {links.map((link, idx) => (
            <div
              key={`${direction}-${link.other_actor_id}-${idx}`}
              className="card p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigateToActor(link.other_actor_id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center">
                    <h4 className="font-medium text-gray-900">{link.other_actor_name}</h4>
                    {link.is_primary && (
                      <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    <span className="capitalize">{link.other_actor_type}</span>
                    {(link.relationship || link.role) && (
                      <>
                        <span className="mx-2">•</span>
                        <span>{link.relationship || link.role}</span>
                      </>
                    )}
                    {link.role_category && (
                      <>
                        <span className="mx-2">•</span>
                        <span>{link.role_category}</span>
                      </>
                    )}
                  </div>
                  {(link.start_date || link.end_date) && (
                    <div className="mt-1 text-xs text-gray-500">
                      {link.start_date && `From ${link.start_date}`}
                      {link.start_date && link.end_date && ' - '}
                      {link.end_date && `To ${link.end_date}`}
                    </div>
                  )}
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-sm text-gray-600">Loading entity details...</p>
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error || 'Entity not found'}</p>
          <button
            onClick={() => {
              // If we have a 'from' location in state, go there, otherwise go back
              const fromLocation = (location.state as any)?.from;
              if (fromLocation) {
                navigate(fromLocation);
              } else {
                navigate(-1);
              }
            }}
            className="mt-4 text-blue-600 hover:underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const isActor = details.type === 'actor';
  const hasNetwork = isActor && (
    (details.links_primary && details.links_primary.length > 0) ||
    (details.links_out && details.links_out.length > 0) ||
    (details.links_in && details.links_in.length > 0)
  );

  return (
    <div className="h-full overflow-y-auto -webkit-overflow-scrolling-touch">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="px-4 md:px-6 py-3 md:py-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900 pr-2">{details.name}</h1>
                {/* Header metadata line */}
                {metadataFields.length > 0 && (
                  <div className="mt-2 flex flex-col sm:flex-row sm:items-center text-xs md:text-sm text-gray-600 space-y-1 sm:space-y-0 sm:space-x-3">
                    {/* Show key header fields */}
                    <div className="flex items-center space-x-3">
                      {metadataFields
                        .filter(field => ['actor_type', 'Type'].includes(field.label))
                        .map(field => (
                          <span key={field.key} className="capitalize">{field.value}</span>
                        ))}
                      {metadataFields
                        .filter(field => ['City', 'State'].includes(field.label))
                        .length > 0 && (
                        <>
                          <span className="hidden sm:inline">•</span>
                          <span>
                            {metadataFields.find(f => f.label === 'City')?.value}
                            {metadataFields.find(f => f.label === 'City') && 
                             metadataFields.find(f => f.label === 'State') && ', '}
                            {metadataFields.find(f => f.label === 'State')?.value}
                          </span>
                        </>
                      )}
                    </div>
                    {details.global_count !== undefined && (
                      <div className="flex items-center">
                        <span className="hidden sm:inline">•</span>
                        <span>{details.global_count.toLocaleString()} total events</span>
                      </div>
                    )}
                  </div>
                )}
                {/* About section if present */}
                {metadataFields.find(f => f.label === 'About') && (
                  <p className="mt-3 text-gray-700">
                    {metadataFields.find(f => f.label === 'About')?.value}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  // If we have a 'from' location in state, go there, otherwise go back
                  const fromLocation = (location.state as any)?.from;
                  if (fromLocation) {
                    navigate(fromLocation);
                  } else {
                    navigate(-1);
                  }
                }}
                className="ml-2 md:ml-4 text-gray-400 hover:text-gray-600 flex-shrink-0 p-2 hover:bg-gray-100 rounded-lg touch-manipulation"
                style={{ minHeight: '44px', minWidth: '44px' }}
              >
                <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Usernames for actors */}
            {details.usernames && details.usernames.length > 0 && (
              <div className="mt-3 md:mt-4 flex flex-wrap gap-1.5 md:gap-2">
                {details.usernames.filter(u => u.handle && u.handle.trim()).map((username, idx) => (
                  <a
                    key={idx}
                    href={username.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-2 md:px-3 py-1.5 md:py-1 rounded-full text-xs md:text-sm bg-gray-100 hover:bg-gray-200 transition-colors touch-manipulation"
                    style={{ minHeight: '32px' }}
                  >
                    <span className="font-medium">{username.platform}</span>
                    <span className="mx-1">:</span>
                    <span className="truncate max-w-32 md:max-w-none">{username.handle.startsWith('@') ? username.handle : `@${username.handle}`}</span>
                    {username.is_primary && (
                      <span className="ml-1 text-xs text-amber-600">•</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="px-4 md:px-6">
            <div className="flex space-x-4 md:space-x-6 border-b overflow-x-auto">
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-3 px-1 md:px-2 border-b-2 transition-colors whitespace-nowrap touch-manipulation text-sm md:text-base ${
                  activeTab === 'overview'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                style={{ minHeight: '44px' }}
              >
                Overview
              </button>
              {hasNetwork && (
                <button
                  onClick={() => setActiveTab('network')}
                  className={`pb-3 px-1 md:px-2 border-b-2 transition-colors whitespace-nowrap touch-manipulation text-sm md:text-base ${
                    activeTab === 'network'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  Network
                </button>
              )}
              <button
                onClick={() => setActiveTab('activity')}
                className={`pb-3 px-1 md:px-2 border-b-2 transition-colors flex items-center whitespace-nowrap touch-manipulation text-sm md:text-base ${
                  activeTab === 'activity'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                style={{ minHeight: '44px' }}
              >
                Activity
                {totalEvents > 0 && (
                  <span className="ml-2 px-1.5 md:px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                    {totalEvents.toLocaleString()}
                  </span>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Tab Content */}
        <div className="p-4 md:p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {isActor && entityId && <ActorProfileSection actorId={entityId} />}

              {stats && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    {/* Top Row - Key Stats - Mobile: 2x2, Desktop: 1x4 */}
                    <div className="md:col-span-3">
                      <div className="card p-3 md:p-4 h-full">
                        <div className="text-xs md:text-sm text-gray-500">Total Events</div>
                        <div className="text-xl md:text-3xl font-bold mt-1">{stats.total_count.toLocaleString()}</div>
                        <div className="text-xs text-gray-400 mt-1 md:mt-2">
                          {timeseriesPeriod === 'week'
                            ? 'Past week'
                            : timeseriesPeriod === 'month'
                            ? 'Past month'
                            : timeseriesPeriod === 'year'
                            ? 'Past year'
                            : 'All time'}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-3">
                      <div className="card p-3 md:p-4 h-full">
                        <div className="text-xs md:text-sm text-gray-500">Geographic Reach</div>
                        <div className="flex items-baseline mt-1">
                          <div className="text-xl md:text-3xl font-bold">{validStateStats.validCount}</div>
                          <span className="ml-1 md:ml-2 text-sm md:text-lg text-gray-600">states</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 md:mt-2">{stats.by_city.length} cities</div>
                      </div>
                    </div>

                    <div className="md:col-span-3">
                      <div className="card p-3 md:p-4 h-full">
                        <div className="text-xs md:text-sm text-gray-500">Average Activity</div>
                        <div className="text-xl md:text-3xl font-bold mt-1">
                          {timeseries ? timeseries.summary.average.toFixed(0) : '-'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1 md:mt-2">Events per {timeseries?.granularity || 'period'}</div>
                      </div>
                    </div>

                    <div className="md:col-span-3">
                      <div className="card p-3 md:p-4 h-full">
                        <div className="text-xs md:text-sm text-gray-500">Activity Trend</div>
                        <div
                          className={`flex items-center mt-1 ${
                            timeseries?.summary.trend === 'increasing'
                              ? 'text-green-600'
                              : timeseries?.summary.trend === 'decreasing'
                              ? 'text-red-600'
                              : 'text-gray-600'
                          }`}
                        >
                          {timeseries?.summary.trend === 'increasing' && (
                            <svg className="w-4 h-4 md:w-6 md:h-6 mr-1 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                          )}
                          {timeseries?.summary.trend === 'decreasing' && (
                            <svg className="w-4 h-4 md:w-6 md:h-6 mr-1 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                            </svg>
                          )}
                          {timeseries?.summary.trend === 'stable' && (
                            <svg className="w-4 h-4 md:w-6 md:h-6 mr-1 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                            </svg>
                          )}
                          <span className="text-xl md:text-2xl font-bold">
                            {timeseries
                              ? timeseries.summary.trend.charAt(0).toUpperCase() + timeseries.summary.trend.slice(1)
                              : '-'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 md:mt-2">
                          {timeseries &&
                            `Peak: ${timeseries.summary.peak_count} on ${new Date(
                              timeseries.summary.peak_date,
                            ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        </div>
                      </div>
                    </div>

                    {/* Activity Chart - Full Width */}
                    <div className="md:col-span-12">
                      <div className="card p-4 md:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 space-y-3 sm:space-y-0">
                          <h3 className="text-base md:text-lg font-semibold">Activity Timeline</h3>
                          <div className="flex overflow-x-auto space-x-1">
                            <button
                              onClick={() => loadTimeseries('week')}
                              disabled={timeseriesLoading}
                              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm rounded-l transition-colors whitespace-nowrap touch-manipulation ${
                                timeseriesPeriod === 'week'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                              style={{ minHeight: '32px' }}
                            >
                              7 Days
                            </button>
                            <button
                              onClick={() => loadTimeseries('month')}
                              disabled={timeseriesLoading}
                              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm transition-colors whitespace-nowrap touch-manipulation ${
                                timeseriesPeriod === 'month'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                              style={{ minHeight: '32px' }}
                            >
                              30 Days
                            </button>
                            <button
                              onClick={() => loadTimeseries('year')}
                              disabled={timeseriesLoading}
                              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm transition-colors whitespace-nowrap touch-manipulation ${
                                timeseriesPeriod === 'year'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                              style={{ minHeight: '32px' }}
                            >
                              1 Year
                            </button>
                            <button
                              onClick={() => loadTimeseries('all' as any)}
                              disabled={timeseriesLoading}
                              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm transition-colors border-l whitespace-nowrap touch-manipulation ${
                                timeseriesPeriod === 'all'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                              style={{ minHeight: '32px' }}
                            >
                              All Time
                            </button>
                            <button
                              onClick={() => {/* TODO: Add custom date range modal */}}
                              disabled={timeseriesLoading}
                              className={`px-2 md:px-3 py-1.5 text-xs md:text-sm rounded-r transition-colors whitespace-nowrap touch-manipulation ${
                                false
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                              style={{ minHeight: '32px' }}
                            >
                              Custom
                            </button>
                          </div>
                        </div>

                        {timeseriesLoading ? (
                          <div className="h-48 md:h-64 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                          </div>
                        ) : timeseries ? (
                          <ActivityChart data={timeseries} height={window.innerWidth < 768 ? 180 : 240} />
                        ) : (
                          <div className="h-48 md:h-64 flex items-center justify-center text-gray-500">
                            No activity data available
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Geographic Distribution */}
                    <div className="md:col-span-6">
                      <div className="card p-4 md:p-6 h-full">
                        <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Top States</h3>
                        {validStateStats.validCount > 0 ? (
                          <div className="space-y-2">
                            {Array.from(validStateStats.statesByCode.entries())
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 8)
                              .map(([stateCode, count], idx) => {
                                const percentage = (count / stats.total_count) * 100;
                                return (
                                  <div key={stateCode}>
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="font-medium">
                                        {idx + 1}. {stateCode}
                                      </span>
                                      <span className="text-gray-600">{count.toLocaleString()}</span>
                                    </div>
                                    <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                                      <div
                                        className="bg-blue-500 h-1.5 rounded-full"
                                        style={{ width: `${Math.min(percentage * 2, 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <div className="text-gray-500 text-center py-8">No state data available</div>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-6">
                      <div className="card p-4 md:p-6 h-full">
                        <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Top Cities</h3>
                        {stats.by_city.length > 0 ? (
                          <div className="space-y-2">
                            {stats.by_city.slice(0, 8).map((city, idx) => {
                              const percentage = (city.count / stats.total_count) * 100;
                              return (
                                <div key={`${city.city}-${city.state}`}>
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium truncate mr-2">
                                      {idx + 1}. {city.city}, {city.state}
                                    </span>
                                    <span className="text-gray-600 flex-shrink-0">{city.count.toLocaleString()}</span>
                                  </div>
                                  <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                                    <div
                                      className="bg-green-500 h-1.5 rounded-full"
                                      style={{ width: `${Math.min(percentage * 4, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-gray-500 text-center py-8">No city data available</div>
                        )}
                      </div>
                    </div>

                    {/* Metadata Details Section */}
                    {extraMetadataFields.length > 0 && (
                      <div className="md:col-span-12 mt-4">
                        <div className="card p-4 md:p-6">
                          <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Details</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                            {extraMetadataFields.map(field => (
                              <div key={field.key} className="border-l-2 border-gray-200 pl-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wider">
                                  {field.label}
                                </div>
                                <div className="text-sm font-medium text-gray-900 mt-1">
                                  {field.value}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {details?.social_profiles && details.social_profiles.length > 0 && (
                      <div className="md:col-span-12 mt-4">
                        <div className="card p-4 md:p-6">
                          <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Social Media Profiles</h3>
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
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'network' && isActor && (
            <div>
              {/* Outgoing relationships */}
              {renderNetworkSection(details.links_out || [], 'Outgoing Connections', 'out')}

              {/* Incoming relationships */}
              {renderNetworkSection(details.links_in || [], 'Incoming Connections', 'in')}

              {!hasNetwork && (
                <div className="text-center py-8 text-gray-500">
                  No network relationships found
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div>
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                <h3 className="text-base md:text-lg font-semibold">
                  Activity ({totalEvents.toLocaleString()})
                </h3>
                <button
                  onClick={async () => {
                    setExporting(true);
                    try {
                      const data: any = await analyticsClient.exportEvents({
                        filters,
                        scope: 'entity',
                        scope_params: { entity_type: entityType, entity_id: entityId }
                      });

                      // Normalize rows, expand post_urls into separate columns, and add header
                      let header: string[] = [];
                      let dataRows: any[][] = [];
                      if (Array.isArray(data) && data.length > 0) {
                        if (typeof data[0] === 'object' && !Array.isArray(data[0])) {
                          const objRows = data as any[];
                          const maxPosts = objRows.reduce((m, r) => Math.max(m, Array.isArray(r.post_urls) ? r.post_urls.length : 0), 0);
                          header = ['event_id','event_date','event_name','city','state','tags','actor_names', ...Array.from({length: maxPosts}, (_, i) => `post_url_${i+1}`)];
                          dataRows = objRows.map(r => {
                            const base = [
                              r.event_id ?? '',
                              r.event_date ?? '',
                              r.event_name ?? '',
                              r.city ?? '',
                              r.state ?? '',
                              Array.isArray(r.tags) ? r.tags.join('|') : '',
                              Array.isArray(r.actor_names) ? r.actor_names.join('|') : ''
                            ];
                            const posts: string[] = Array.isArray(r.post_urls) ? r.post_urls : [];
                            const postCols = Array.from({length: maxPosts}, (_, i) => posts[i] ?? '');
                            return [...base, ...postCols];
                          });
                        } else if (Array.isArray(data[0])) {
                          header = ['event_id','event_date','event_name','city','state','tags','actor_names','post_urls'];
                          dataRows = data as any[][];
                        }
                      } else {
                        header = ['event_id','event_date','event_name','city','state','tags','actor_names'];
                      }

                      const escapeCell = (cell: any) => {
                        const s = String(cell ?? '');
                        return s.includes(',') || s.includes('"') || s.includes('\n')
                          ? '"' + s.replace(/"/g, '""') + '"'
                          : s;
                      };
                      const csvLines = [header, ...dataRows].map((row) => {
                        if (Array.isArray(row)) return row.map(escapeCell).join(',');
                        if (row && typeof row === 'object') return Object.values(row).map(escapeCell).join(',');
                        return escapeCell(row);
                      });
                      const csv = csvLines.join('\n');
                      
                      // Download
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
                  className="btn btn-outline btn-sm touch-manipulation text-xs md:text-sm"
                  style={{ minHeight: '36px' }}
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
              </div>
              
              {events.length === 0 && !eventsLoading ? (
                <div className="text-center py-8 text-gray-500">No events found</div>
              ) : (
                <div className="space-y-2 md:space-y-3">
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
                        className="btn btn-outline touch-manipulation text-sm md:text-base"
                        style={{ minHeight: '44px' }}
                      >
                        {eventsLoading ? 'Loading...' : 'Load More'}
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

const ActorProfileSection: React.FC<{ actorId: string }> = ({ actorId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [usernames, setUsernames] = useState<ActorUsername[]>([]);
  const [relationships, setRelationships] = useState<ActorRelationship[]>([]);
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
  const searchTimeoutRef = useRef<number | undefined>();

  const loadActorData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, usernamesData, relationshipsData, membersData] = await Promise.all([
        fetchActorDetails(actorId),
        fetchActorUsernames(actorId),
        fetchActorRelationships(actorId),
        fetchActorMembers(actorId),
      ]);

      setActor(detail ?? null);
      setUsernames(usernamesData);
      setRelationships(relationshipsData);
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
    setRelationshipDrafts(drafts);
    setRelationshipErrors({});
  }, [relationships]);

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
      const [nextRelationships, nextMembers] = await Promise.all([
        fetchActorRelationships(actor.id),
        fetchActorMembers(actor.id),
      ]);
      setRelationships(nextRelationships);
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

  const updateRelationshipDraft = useCallback(
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

  const handleSaveRelationship = async (rel: ActorRelationship) => {
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

  const handleDeleteRelationship = async (rel: ActorRelationship) => {
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

  const handleCreateRelationship = async () => {
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
          setRelationshipDrafts(drafts);
        }
      }
      return next;
    });
  };

  const relationshipList = relationships;
  const membersPreview = useMemo(() => members.slice(0, 12), [members]);
  const profileMessage = profileStatus?.text ?? '';

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Actor Profile</h2>
          {actor && (
            <p className="mt-1 text-lg font-semibold text-gray-900">{actor.name ?? 'Unnamed Actor'}</p>
          )}
          {actor && (
            <p className="text-sm text-gray-500">
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
              className={`inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium transition ${
                isEditing ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
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
          <div className="flex items-center justify-center py-8 text-sm text-gray-500">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span className="ml-3">Loading profile…</span>
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={loadActorData}
                className="ml-4 rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
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
                  <label className="space-y-1 text-sm text-gray-600">
                    <span className="font-medium text-gray-700">Name</span>
                    <input
                      value={profileForm.name}
                      onChange={event => handleProfileChange('name', event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      placeholder="Actor name"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-gray-600">
                    <span className="font-medium text-gray-700">Type</span>
                    <select
                      value={profileForm.actor_type}
                      onChange={event => handleProfileChange('actor_type', event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="">Select type</option>
                      {ACTOR_TYPE_OPTIONS.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm text-gray-600">
                    <span className="font-medium text-gray-700">City</span>
                    <input
                      value={profileForm.city}
                      onChange={event => handleProfileChange('city', event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      placeholder="Phoenix"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-gray-600">
                    <span className="font-medium text-gray-700">State</span>
                    <input
                      value={profileForm.state}
                      onChange={event => handleProfileChange('state', event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      placeholder="AZ"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-gray-600">
                    <span className="font-medium text-gray-700">Region</span>
                    <input
                      value={profileForm.region}
                      onChange={event => handleProfileChange('region', event.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      placeholder="Maricopa County"
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={profileForm.should_scrape}
                      onChange={event => handleProfileChange('should_scrape', event.target.checked)}
                    />
                    <span className="font-medium text-gray-700">Eligible for scraping</span>
                  </label>
                </div>
                <label className="space-y-1 text-sm text-gray-600">
                  <span className="font-medium text-gray-700">About</span>
                  <textarea
                    value={profileForm.about}
                    onChange={event => handleProfileChange('about', event.target.value)}
                    rows={5}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Summary, biography, notes"
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-medium">
                    {profileStatus?.type === 'error' && <span className="text-rose-600">{profileMessage}</span>}
                    {profileStatus?.type === 'success' && <span className="text-emerald-600">{profileMessage}</span>}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={toggleEditing}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:border-gray-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!profileDirty || profileSaving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {profileSaving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Add Relationship</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
                      <div>
                        <label className="space-y-1 text-sm text-gray-600">
                          <span className="font-medium text-gray-700">Search actors</span>
                          <input
                            value={newLinkSearch}
                            onChange={event => {
                              setNewLinkSearch(event.target.value);
                              setSelectedNewLink(null);
                            }}
                            placeholder="Search by name, city, or state"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                          {isSearchingLinks ? (
                            <div className="flex items-center justify-center py-6 text-sm text-gray-500">Searching…</div>
                          ) : newLinkResults.length === 0 ? (
                            <div className="py-5 text-center text-xs text-gray-400">
                              {newLinkSearch.trim().length < 2 ? 'Type at least two characters to search' : 'No actors found'}
                            </div>
                          ) : (
                            <ul className="divide-y divide-gray-100 text-sm">
                              {newLinkResults.map(option => {
                                const selected = selectedNewLink?.id === option.id;
                                return (
                                  <li key={option.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedNewLink(option);
                                        setNewLinkSearch(option.name ?? '');
                                      }}
                                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition ${
                                        selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                                      }`}
                                    >
                                      <span className="font-medium">{option.name ?? 'Unnamed actor'}</span>
                                      <span className="text-xs text-gray-500">
                                        {option.actor_type?.toUpperCase() ?? '—'}
                                        {(option.city || option.state) && ` • ${[option.city, option.state].filter(Boolean).join(', ')}`}
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
                        <label className="space-y-1 text-sm text-gray-600">
                          <span className="font-medium text-gray-700">Relationship Type</span>
                          <input
                            value={newLinkRelationship}
                            onChange={event => setNewLinkRelationship(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            placeholder="member, staff, etc."
                          />
                        </label>
                        <label className="space-y-1 text-sm text-gray-600">
                          <span className="font-medium text-gray-700">Role</span>
                          <input
                            value={newLinkRole}
                            onChange={event => setNewLinkRole(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            placeholder="Field Representative"
                          />
                        </label>
                        {newLinkError && <p className="text-xs font-medium text-rose-600">{newLinkError}</p>}
                        <button
                          type="button"
                          onClick={handleCreateRelationship}
                          disabled={isCreatingLink || !selectedNewLink}
                          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                        >
                          {isCreatingLink ? 'Linking…' : selectedNewLink ? `Link ${selectedNewLink.name ?? 'Actor'}` : 'Select an actor to link'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <header className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Existing Relationships</h3>
                      <span className="text-xs text-gray-500">{relationshipList.length} linked</span>
                    </header>
                    {relationshipGlobalError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                        {relationshipGlobalError}
                      </div>
                    )}
                    {relationshipList.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                        No relationships recorded yet.
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {relationshipList.map(rel => {
                          const key = relationshipKey(rel);
                          const draft = relationshipDrafts[key] ?? { relationship: rel.relationship ?? '', role: rel.role ?? '' };
                          const isSaving = relationshipSavingKey === key;
                          const isDeleting = relationshipDeletingKey === key;
                          const rowError = relationshipErrors[key];
                          const saved = relationshipSuccessKey === key;

                          return (
                            <li key={key} className="rounded-lg border border-gray-200 bg-white p-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <div className="text-base font-semibold text-gray-900">{rel.to_actor?.name ?? rel.to_actor_id}</div>
                                  <div className="text-xs text-gray-500">
                                    {rel.to_actor?.actor_type?.toUpperCase() ?? '—'}
                                    {(rel.to_actor?.city || rel.to_actor?.state) &&
                                      ` • ${[rel.to_actor?.city, rel.to_actor?.state].filter(Boolean).join(', ')}`}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRelationship(rel)}
                                  disabled={isDeleting || isSaving}
                                  className="self-start rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isDeleting ? 'Removing…' : 'Remove'}
                                </button>
                              </div>
                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <label className="space-y-1 text-sm text-gray-600">
                                  <span className="font-medium text-gray-700">Relationship</span>
                                  <input
                                    value={draft.relationship}
                                    onChange={event => updateRelationshipDraft(key, 'relationship', event.target.value)}
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    placeholder="member"
                                  />
                                </label>
                                <label className="space-y-1 text-sm text-gray-600">
                                  <span className="font-medium text-gray-700">Role</span>
                                  <input
                                    value={draft.role}
                                    onChange={event => updateRelationshipDraft(key, 'role', event.target.value)}
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    placeholder="Organizer"
                                  />
                                </label>
                              </div>
                              <div className="mt-3 flex flex-col gap-2 text-xs md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-3 font-medium">
                                  {rowError && <span className="text-rose-600">{rowError}</span>}
                                  {saved && !rowError && <span className="text-emerald-600">Saved</span>}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSaveRelationship(rel)}
                                  disabled={isSaving || isDeleting}
                                  className="self-start rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
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
              </form>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 text-sm text-gray-600">
                    <div>
                      <span className="text-xs uppercase text-gray-400">Type</span>
                      <div className="font-medium text-gray-900">{actor.actor_type ?? '—'}</div>
                    </div>
                    <div>
                      <span className="text-xs uppercase text-gray-400">Location</span>
                      <div className="font-medium text-gray-900">{[actor.city, actor.state].filter(Boolean).join(', ') || '—'}</div>
                    </div>
                    <div>
                      <span className="text-xs uppercase text-gray-400">Region</span>
                      <div className="font-medium text-gray-900">{actor.region ?? '—'}</div>
                    </div>
                    <div>
                      <span className="text-xs uppercase text-gray-400">About</span>
                      <p className="mt-1 text-gray-700">{actor.about?.trim() || 'No description available.'}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Social Handles</h3>
                    {usernames.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-500">No handles linked.</p>
                    ) : (
                      <ul className="mt-3 space-y-2 text-sm">
                        {usernames.map(handle => (
                          <li key={handle.id} className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                            <span className="font-medium text-gray-800">@{handle.username}</span>
                            <span className="text-xs uppercase tracking-wide text-gray-500">{handle.platform}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Relationships</h3>
                  {relationshipList.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No relationships recorded.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-gray-600">
                      {relationshipList.map(rel => (
                        <li key={relationshipKey(rel)} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                          <div className="text-gray-800 font-medium">{rel.to_actor?.name ?? rel.to_actor_id}</div>
                          <div className="text-xs text-gray-500">
                            {rel.relationship ?? 'relationship'}
                            {rel.role ? ` • ${rel.role}` : ''}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {membersPreview.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Members</h3>
                    <ul className="mt-3 space-y-2 text-sm text-gray-600">
                      {membersPreview.map(member => (
                        <li key={member.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                          <div className="text-gray-800">{member.member_actor?.name ?? member.member_actor_id}</div>
                          <div className="text-xs text-gray-500">{member.role ?? 'Member'}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-500">Actor not found.</div>
        )}
      </div>
    </section>
  );
};
