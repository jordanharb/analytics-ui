import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { analyticsClient } from '../../api/analyticsClient';
import { useFiltersStore } from '../../state/filtersStore';
import { EventCard } from '../../components/EventCard/EventCard';
import { ActivityChart } from '../../components/ActivityChart/ActivityChart';
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

  // Load entity details
  useEffect(() => {
    if (!entityType || !entityId) return;
    
    const loadDetails = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // For entity view, use all-time stats and independent timeseries
        const allTimeFilters = { period: 'all' as const };
        
        const [detailsData, statsData, timeseriesData] = await Promise.all([
          analyticsClient.getEntityDetails(entityType as any, entityId),
          analyticsClient.getEntityStats(entityType as any, entityId, allTimeFilters),
          analyticsClient.getEntityTimeseries(entityType as any, entityId, allTimeFilters, 'month')
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
  }, [entityType, entityId]); // Don't reload on filter changes

  // Load events
  const loadEvents = useCallback(async (isInitial = false) => {
    if (!entityType || !entityId || eventsLoading) return;
    
    setEventsLoading(true);
    
    try {
      // Don't use global filters for entity events - show all events
      const allTimeFilters = { period: 'all' as const };
      
      const response = await analyticsClient.getEntityEvents(
        entityType as any,
        entityId,
        allTimeFilters,
        50,
        isInitial ? undefined : cursor
      );
      
      // Dedupe events
      const newEvents = isInitial ? response.events : [...events, ...response.events];
      const uniqueEvents = Array.from(
        new Map(newEvents.map(e => [e.id, e])).values()
      );
      
      setEvents(uniqueEvents);
      setTotalEvents(response.total_count);
      setCursor(response.next_cursor);
      setHasMore(response.has_more);
    } catch (err: any) {
      console.error('Error loading events:', err);
    } finally {
      setEventsLoading(false);
    }
  }, [entityType, entityId, cursor, events, eventsLoading]); // Don't depend on filters

  // Initial events load
  useEffect(() => {
    loadEvents(true);
  }, [entityType, entityId]); // Don't reload on filter changes

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
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="px-6 py-4">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{details.name}</h1>
                {details.metadata && (
                  <div className="mt-2 flex items-center text-sm text-gray-600 space-x-3">
                    {details.metadata.actor_type && (
                      <span className="capitalize">{details.metadata.actor_type}</span>
                    )}
                    {(details.metadata.city || details.metadata.state) && (
                      <>
                        <span>•</span>
                        <span>
                          {details.metadata.city && `${details.metadata.city}, `}
                          {details.metadata.state}
                        </span>
                      </>
                    )}
                    {details.global_count !== undefined && (
                      <>
                        <span>•</span>
                        <span>{details.global_count.toLocaleString()} total events</span>
                      </>
                    )}
                  </div>
                )}
                {details.metadata?.about && (
                  <p className="mt-3 text-gray-700">{details.metadata.about}</p>
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
                className="ml-4 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Usernames for actors */}
            {details.usernames && details.usernames.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {details.usernames.filter(u => u.handle && u.handle.trim()).map((username, idx) => (
                  <a
                    key={idx}
                    href={username.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    <span className="font-medium">{username.platform}</span>
                    <span className="mx-1">:</span>
                    <span>{username.handle.startsWith('@') ? username.handle : `@${username.handle}`}</span>
                    {username.is_primary && (
                      <span className="ml-1 text-xs text-amber-600">•</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="px-6">
            <div className="flex space-x-6 border-b">
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-3 px-1 border-b-2 transition-colors ${
                  activeTab === 'overview'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Overview
              </button>
              {hasNetwork && (
                <button
                  onClick={() => setActiveTab('network')}
                  className={`pb-3 px-1 border-b-2 transition-colors ${
                    activeTab === 'network'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Network
                </button>
              )}
              <button
                onClick={() => setActiveTab('events')}
                className={`pb-3 px-1 border-b-2 transition-colors flex items-center ${
                  activeTab === 'events'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Events
                {totalEvents > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                    {totalEvents.toLocaleString()}
                  </span>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'overview' && stats && (
            <div className="grid grid-cols-12 gap-4">
              {/* Top Row - Key Stats */}
              <div className="col-span-3">
                <div className="card p-4 h-full">
                  <div className="text-sm text-gray-500">Total Events</div>
                  <div className="text-3xl font-bold mt-1">{stats.total_count.toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-2">Across all time</div>
                </div>
              </div>
              
              <div className="col-span-3">
                <div className="card p-4 h-full">
                  <div className="text-sm text-gray-500">Geographic Reach</div>
                  <div className="flex items-baseline mt-1">
                    <div className="text-3xl font-bold">{stats.by_state.length}</div>
                    <span className="ml-2 text-lg text-gray-600">states</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">{stats.by_city.length} cities</div>
                </div>
              </div>
              
              <div className="col-span-3">
                <div className="card p-4 h-full">
                  <div className="text-sm text-gray-500">Average Activity</div>
                  <div className="text-3xl font-bold mt-1">
                    {timeseries ? timeseries.summary.average.toFixed(0) : '-'}
                  </div>
                  <div className="text-xs text-gray-400 mt-2">Events per {timeseries?.granularity || 'period'}</div>
                </div>
              </div>
              
              <div className="col-span-3">
                <div className="card p-4 h-full">
                  <div className="text-sm text-gray-500">Activity Trend</div>
                  <div className={`flex items-center mt-1 ${
                    timeseries?.summary.trend === 'increasing' ? 'text-green-600' :
                    timeseries?.summary.trend === 'decreasing' ? 'text-red-600' :
                    'text-gray-600'
                  }`}>
                    {timeseries?.summary.trend === 'increasing' && (
                      <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    )}
                    {timeseries?.summary.trend === 'decreasing' && (
                      <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                      </svg>
                    )}
                    {timeseries?.summary.trend === 'stable' && (
                      <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                      </svg>
                    )}
                    <span className="text-2xl font-bold">
                      {timeseries ? (timeseries.summary.trend.charAt(0).toUpperCase() + timeseries.summary.trend.slice(1)) : '-'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">
                    {timeseries && `Peak: ${timeseries.summary.peak_count} on ${new Date(timeseries.summary.peak_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </div>
                </div>
              </div>

              {/* Activity Chart - Full Width */}
              <div className="col-span-12">
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Activity Timeline</h3>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => loadTimeseries('week')}
                        disabled={timeseriesLoading}
                        className={`px-3 py-1.5 text-sm rounded-l transition-colors ${
                          timeseriesPeriod === 'week' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        7 Days
                      </button>
                      <button
                        onClick={() => loadTimeseries('month')}
                        disabled={timeseriesLoading}
                        className={`px-3 py-1.5 text-sm transition-colors ${
                          timeseriesPeriod === 'month' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        30 Days
                      </button>
                      <button
                        onClick={() => loadTimeseries('year')}
                        disabled={timeseriesLoading}
                        className={`px-3 py-1.5 text-sm transition-colors ${
                          timeseriesPeriod === 'year' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        1 Year
                      </button>
                      <button
                        onClick={() => loadTimeseries('all' as any)}
                        disabled={timeseriesLoading}
                        className={`px-3 py-1.5 text-sm transition-colors border-l ${
                          timeseriesPeriod === 'all' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        All Time
                      </button>
                      <button
                        onClick={() => {/* TODO: Add custom date range modal */}}
                        disabled={timeseriesLoading}
                        className={`px-3 py-1.5 text-sm rounded-r transition-colors ${
                          false 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        Custom
                      </button>
                    </div>
                  </div>
                  
                  {timeseriesLoading ? (
                    <div className="h-64 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  ) : timeseries ? (
                    <ActivityChart data={timeseries} height={240} />
                  ) : (
                    <div className="h-64 flex items-center justify-center text-gray-500">
                      No activity data available
                    </div>
                  )}
                </div>
              </div>

              {/* Geographic Distribution */}
              <div className="col-span-6">
                <div className="card p-6 h-full">
                  <h3 className="text-lg font-semibold mb-4">Top States</h3>
                  {stats.by_state.length > 0 ? (
                    <div className="space-y-2">
                      {stats.by_state.slice(0, 8).map((state, idx) => {
                        const percentage = (state.count / stats.total_count) * 100;
                        return (
                          <div key={state.state}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">
                                {idx + 1}. {state.state}
                              </span>
                              <span className="text-gray-600">{state.count.toLocaleString()}</span>
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

              <div className="col-span-6">
                <div className="card p-6 h-full">
                  <h3 className="text-lg font-semibold mb-4">Top Cities</h3>
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
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">
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
                  className="btn btn-outline btn-sm"
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
              </div>
              
              {events.length === 0 && !eventsLoading ? (
                <div className="text-center py-8 text-gray-500">No events found</div>
              ) : (
                <div className="space-y-3">
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
                        className="btn btn-outline"
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