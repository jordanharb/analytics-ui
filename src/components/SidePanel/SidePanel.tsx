import React, { useState, useEffect, useCallback, useRef } from 'react';
import { analyticsClient } from '../../api/analyticsClient';
import { useFiltersStore } from '../../state/filtersStore';
import { EventCard } from '../EventCard/EventCard';
import type { EventSummary, Cursor, Filters } from '../../api/types';

interface SidePanelProps {
  city?: { city: string; state: string } | null;
  cluster?: Array<{ city: string; state: string }> | null;
  showVirtual?: boolean;
  filters: Filters;
  onClose: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  city,
  cluster,
  showVirtual,
  filters,
  onClose
}) => {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<Cursor | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  
  // Cluster view state
  const [selectedCity, setSelectedCity] = useState<{ city: string; state: string } | null>(null);
  const [clusterCounts, setClusterCounts] = useState<Record<string, number>>({});
  const [showAllCities, setShowAllCities] = useState(false);
  const [originalCluster, setOriginalCluster] = useState<Array<{ city: string; state: string }> | null>(null);
  
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Check if panel should be open
  const isOpen = !!(city || cluster || showVirtual);
  
  // Reset when target changes
  useEffect(() => {
    if (city || cluster || showVirtual) {
      setEvents([]);
      setCursor(undefined);
      setHasMore(false);
      setExpandedEventId(null);
      setSelectedCity(null);
      setShowAllCities(false);
      
      // Store original cluster for back navigation
      if (cluster) {
        setOriginalCluster(cluster);
        // Initialize cluster counts with 0 so cities show immediately
        const initialCounts: Record<string, number> = {};
        cluster.forEach(location => {
          initialCounts[`${location.city}, ${location.state}`] = 0;
        });
        setClusterCounts(initialCounts);
        // Load actual counts asynchronously
        loadClusterCounts(cluster);
      } else {
        setOriginalCluster(null);
        setClusterCounts({});
      }
      
      loadEvents(true);
    }
  }, [city, cluster, showVirtual, filters]);

  // Setup infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadEvents(false);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, loading]);

  const { networkExpanded, expandedActorIds } = useFiltersStore();
  
  // Load event counts for each city in cluster
  const loadClusterCounts = async (cities: Array<{ city: string; state: string }>) => {
    try {
      const counts: Record<string, number> = {};
      
      // Get counts for each city
      for (const location of cities) {
        const response = await analyticsClient.getCityEvents(
          location,
          filters,
          1,
          undefined
        );
        counts[`${location.city}, ${location.state}`] = response.total_count;
      }
      
      setClusterCounts(counts);
    } catch (err) {
      console.error('Failed to load cluster counts:', err);
    }
  };
  
  const loadEvents = useCallback(async (isInitial: boolean) => {
    if (loading) return;
    
    setLoading(true);
    setError(null);

    try {
      let target;
      
      if (showVirtual) {
        // For virtual events, use the new virtual target format
        target = { virtual: true };
      } else if (selectedCity) {
        // When a city is selected from cluster, show that city
        target = selectedCity;
      } else if (city) {
        target = city;
      } else if (cluster) {
        target = { cities: cluster };
      } else {
        return;
      }

      // Apply network expansion if enabled
      let effectiveFilters = { ...filters };
      if (networkExpanded && expandedActorIds) {
        effectiveFilters = { ...filters, actor_ids: expandedActorIds };
      }

      const response = await analyticsClient.getCityEvents(
        target,
        effectiveFilters,
        50,
        isInitial ? undefined : cursor
      );

      if (isInitial) {
        setEvents(response.events);
        setTotalCount(response.total_count);
      } else {
        // Deduplicate events when loading more
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const newEvents = response.events.filter(e => !existingIds.has(e.id));
          return [...prev, ...newEvents];
        });
      }
      
      setCursor(response.next_cursor);
      setHasMore(response.has_more);
    } catch (err: any) {
      setError(err.message || 'Failed to load events');
      console.error('Error loading events:', err);
    } finally {
      setLoading(false);
    }
  }, [city, cluster, selectedCity, showVirtual, filters, cursor, loading]);

  const getTitle = () => {
    if (showVirtual) {
      return 'Virtual/Non-geocoded Events';
    } else if (selectedCity) {
      return `${selectedCity.city}, ${selectedCity.state}`;
    } else if (city) {
      return `${city.city}, ${city.state}`;
    } else if (cluster && cluster.length > 0) {
      return `Cluster: ${cluster.length} Cities`;
    }
    return '';
  };

  const getSubtitle = () => {
    if (showVirtual) {
      return 'Events without geographic coordinates';
    } else if (selectedCity && originalCluster) {
      return 'Part of cluster';
    } else if (cluster) {
      const total = Object.values(clusterCounts).reduce((sum, count) => sum + count, 0);
      return `${total.toLocaleString()} total events`;
    }
    return '';
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className={`panel fixed right-0 top-0 h-full w-full max-w-lg ${
        isOpen ? 'panel-open' : ''
      }`}>
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="panel-header bg-snow-150">
            {/* Back button for city view within cluster */}
            {selectedCity && originalCluster && (
              <button
                onClick={() => {
                  setSelectedCity(null);
                  setEvents([]);
                  setCursor(undefined);
                  setHasMore(false);
                  loadEvents(true);
                }}
                className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-2"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to cluster
              </button>
            )}
            
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h2 className="panel-title">
                  {getTitle()}
                </h2>
                
                {/* Cluster city tokens */}
                {cluster && !selectedCity && Object.keys(clusterCounts).length > 0 && (
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(clusterCounts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, showAllCities ? undefined : 5)
                        .map(([cityKey, count]) => {
                          const [cityName, stateName] = cityKey.split(', ');
                          return (
                            <button
                              key={cityKey}
                              onClick={() => {
                                setSelectedCity({ city: cityName, state: stateName });
                                setEvents([]);
                                setCursor(undefined);
                                setHasMore(false);
                                loadEvents(true);
                              }}
                              className="inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
                            >
                              <span className="font-medium">{cityName}</span>
                              {count === 0 ? (
                                <span className="ml-2 px-2 py-0.5 bg-blue-100 rounded-full text-xs">
                                  <span className="inline-block animate-pulse">...</span>
                                </span>
                              ) : (
                                <span className="ml-2 px-2 py-0.5 bg-blue-200 rounded-full text-xs font-bold">
                                  {count.toLocaleString()}
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                    
                    {/* Show more/less toggle */}
                    {Object.keys(clusterCounts).length > 5 && (
                      <button
                        onClick={() => setShowAllCities(!showAllCities)}
                        className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        {showAllCities 
                          ? 'Show less' 
                          : `Show ${Object.keys(clusterCounts).length - 5} more cities`
                        }
                      </button>
                    )}
                  </div>
                )}
                
                {(cluster || selectedCity) && (
                  <p className="text-sm text-gray-600 mt-1">
                    {getSubtitle()}
                  </p>
                )}
                <p className="text-sm text-gray-500 mt-2">
                  {totalCount.toLocaleString()} total events
                </p>
              </div>
              <button
                onClick={onClose}
                className="ml-4 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Events List */}
          <div className="panel-body">
            {error ? (
              <div className="p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700">{error}</p>
                  <button
                    onClick={() => loadEvents(true)}
                    className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : events.length === 0 && !loading ? (
              <div className="p-6">
                <p className="text-center text-gray-500">No events found</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isExpanded={expandedEventId === event.id}
                    onToggleExpand={() => 
                      setExpandedEventId(expandedEventId === event.id ? null : event.id)
                    }
                  />
                ))}
                
                {/* Loading indicator for pagination */}
                {loading && events.length > 0 && (
                  <div className="py-4 text-center">
                    <div className="spinner"></div>
                  </div>
                )}
                
                {/* Initial loading */}
                {loading && events.length === 0 && (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                        <div className="h-3 bg-gray-200 rounded w-full"></div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Load more trigger */}
                {hasMore && !loading && (
                  <div ref={loadMoreRef} className="py-4 text-center">
                    <button
                      onClick={() => loadEvents(false)}
                      className="text-link text-sm"
                    >
                      Load more
                    </button>
                  </div>
                )}
                
                {/* End of list */}
                {!hasMore && events.length > 0 && (
                  <div className="py-4 text-center text-sm text-gray-500">
                    End of results
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer with export button */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => {
                // Export functionality will be implemented
                console.log('Export events for', city || cluster);
              }}
              className="btn-primary w-full flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>
      </div>
    </>
  );
};