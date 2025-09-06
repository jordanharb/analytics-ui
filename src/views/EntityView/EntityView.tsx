import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { analyticsClient } from '../../api/analyticsClient';
import { useFiltersStore } from '../../state/filtersStore';
import { EventCard } from '../../components/EventCard/EventCard';
import { ActivityChart } from '../../components/ActivityChart/ActivityChart';
import { getUniqueValidStates } from '../../utils/stateUtils';
import { getOrderedMetadataFields } from '../../utils/metadataUtils';
import { SocialProfile } from '../../components/SocialProfile/SocialProfile';
import type { EntityDetails, EntityStats, EventSummary, ActorLink, TimeseriesResponse } from '../../api/types';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'network' | 'events'>('overview');
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
                onClick={() => setActiveTab('events')}
                className={`pb-3 px-1 md:px-2 border-b-2 transition-colors flex items-center whitespace-nowrap touch-manipulation text-sm md:text-base ${
                  activeTab === 'events'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                style={{ minHeight: '44px' }}
              >
                Events
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
          {activeTab === 'overview' && stats && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              {/* Top Row - Key Stats - Mobile: 2x2, Desktop: 1x4 */}
              <div className="md:col-span-3">
                <div className="card p-3 md:p-4 h-full">
                  <div className="text-xs md:text-sm text-gray-500">Total Events</div>
                  <div className="text-xl md:text-3xl font-bold mt-1">{stats.total_count.toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1 md:mt-2">
                    {timeseriesPeriod === 'week' ? 'Past week' :
                     timeseriesPeriod === 'month' ? 'Past month' :
                     timeseriesPeriod === 'year' ? 'Past year' :
                     'All time'}
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
                  <div className={`flex items-center mt-1 ${
                    timeseries?.summary.trend === 'increasing' ? 'text-green-600' :
                    timeseries?.summary.trend === 'decreasing' ? 'text-red-600' :
                    'text-gray-600'
                  }`}>
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
                      {timeseries ? (timeseries.summary.trend.charAt(0).toUpperCase() + timeseries.summary.trend.slice(1)) : '-'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1 md:mt-2">
                    {timeseries && `Peak: ${timeseries.summary.peak_count} on ${new Date(timeseries.summary.peak_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
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
              {(() => {
                const detailsFields = metadataFields.filter(field => 
                  // Don't show fields already displayed in header or as primary stats
                  !['About', 'Type', 'City', 'State'].includes(field.label)
                );
                return detailsFields.length > 0 && (
                  <div className="md:col-span-12 mt-4">
                    <div className="card p-4 md:p-6">
                      <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Details</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                        {detailsFields.map(field => (
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
                );
              })()}
              
              {/* Social Profiles Section */}
              {details.social_profiles && details.social_profiles.length > 0 && (
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

          {activeTab === 'events' && (
            <div>
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                <h3 className="text-base md:text-lg font-semibold">
                  Events ({totalEvents.toLocaleString()})
                </h3>
                <button
                  onClick={async () => {
                    setExporting(true);
                    try {
                      const data = await analyticsClient.exportEvents({
                        filters,
                        scope: 'entity',
                        scope_params: { entity_type: entityType, entity_id: entityId }
                      });
                      
                      // Convert to CSV
                      const csv = data.map(row => 
                        row.map(cell => 
                          typeof cell === 'string' && cell.includes(',') 
                            ? `"${cell}"` 
                            : cell
                        ).join(',')
                      ).join('\n');
                      
                      // Download
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${details.name.replace(/[^a-z0-9]/gi, '_')}_events.csv`;
                      a.click();
                      window.URL.revokeObjectURL(url);
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