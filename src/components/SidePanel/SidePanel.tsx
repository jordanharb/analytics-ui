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
  const [exporting, setExporting] = useState(false);
  
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
          const cityName = location.city || 'Statewide';
          initialCounts[`${cityName}, ${location.state}`] = 0;
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
        const cityName = location.city || 'Statewide';
        counts[`${cityName}, ${location.state}`] = response.total_count;
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
      const cityName = selectedCity.city || 'Statewide';
      return `${cityName}, ${selectedCity.state}`;
    } else if (city) {
      const cityName = city.city || 'Statewide';
      return `${cityName}, ${city.state}`;
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
      // Don't show total here as it's already shown elsewhere
      return '';
    }
    return '';
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className="fixed inset-0 top-16 bg-black bg-opacity-50 z-40 lg:hidden"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className={`panel fixed right-0 w-full max-w-lg z-50 ${
        isOpen ? 'panel-open' : ''
      }`}>
        <div className="h-full flex flex-col overflow-hidden">
          {/* Header */}
          <div className="panel-header bg-snow-150 p-4 md:p-6 flex-shrink-0 border-b border-gray-200">
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
                  <div className="mt-2 max-h-48 overflow-y-auto">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(clusterCounts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, showAllCities ? undefined : 4)
                        .map(([cityKey, count]) => {
                          const [cityName, stateName] = cityKey.split(', ');
                          // Handle Statewide (convert back to empty string for API)
                          const actualCity = cityName === 'Statewide' ? '' : cityName;
                          return (
                            <button
                              key={cityKey}
                              onClick={() => {
                                setSelectedCity({ city: actualCity, state: stateName });
                                setEvents([]);
                                setCursor(undefined);
                                setHasMore(false);
                                loadEvents(true);
                              }}
                              className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors touch-manipulation"
                              style={{ minHeight: '28px' }}
                            >
                              <span className="font-medium">{cityName}</span>
                              {count === 0 ? (
                                <span className="ml-1 px-1.5 py-0.5 bg-blue-100 rounded-full text-xs">
                                  <span className="inline-block animate-pulse">...</span>
                                </span>
                              ) : (
                                <span className="ml-1 px-1.5 py-0.5 bg-blue-200 rounded-full text-xs font-bold">
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                    
                    {/* Show more/less toggle */}
                    {Object.keys(clusterCounts).length > 4 && (
                      <button
                        onClick={() => setShowAllCities(!showAllCities)}
                        className="mt-1.5 text-xs text-blue-600 hover:text-blue-800 touch-manipulation"
                        style={{ minHeight: '32px' }}
                      >
                        {showAllCities 
                          ? 'Show less' 
                          : `+${Object.keys(clusterCounts).length - 4} more`
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
          <div className="panel-body flex-1 overflow-y-auto -webkit-overflow-scrolling-touch">
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
              <div className="p-2 md:p-4 space-y-2">
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
                {loading && events.length > 0 && hasMore && (
                  <div className="py-4 text-center">
                    <div className="spinner"></div>
                  </div>
                )}
                
                {/* Initial loading */}
                {loading && events.length === 0 && (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 animate-pulse">
                        <div className="h-3 bg-gray-200 rounded w-3/4 mb-2"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2 mb-1"></div>
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
          <div className="px-4 md:px-6 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <button
              onClick={async () => {
                try {
                  setExporting(true);
                  // Build scope and params based on current view
                  let scope: 'city' | 'cluster' | 'map' | 'virtual' = 'map';
                  let scope_params: Record<string, any> = {};

                  if (showVirtual) {
                    // Export only virtual/non-geocoded events
                    scope = 'virtual';
                    scope_params = {};
                  } else if (selectedCity || city) {
                    const targetCity = selectedCity || city!;
                    scope = 'city';
                    scope_params = { city: targetCity.city || 'Statewide', state: targetCity.state };
                  } else if (cluster && cluster.length > 0) {
                    scope = 'cluster';
                    scope_params = { cities: cluster };
                  }

                  // Respect network expansion if enabled
                  let effectiveFilters = { ...filters };
                  if (networkExpanded && expandedActorIds) {
                    effectiveFilters = { ...filters, actor_ids: expandedActorIds };
                  }

                  const rows: any = await analyticsClient.exportEvents({
                    scope,
                    scope_params,
                    filters: effectiveFilters
                  });

                  // Normalize rows: handle array-of-objects (preferred) or array-of-arrays
                  let header: string[] = [];
                  let dataRows: any[][] = [];
                  if (Array.isArray(rows) && rows.length > 0) {
                    if (typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
                      const objRows = rows as any[];
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
                    } else if (Array.isArray(rows[0])) {
                      // Already arrays (headerless) — fallback to a static header including a single post_urls column
                      header = ['event_id','event_date','event_name','city','state','tags','actor_names','post_urls'];
                      dataRows = rows as any[][];
                    }
                  } else {
                    header = ['event_id','event_date','event_name','city','state','tags','actor_names'];
                  }

                  // Convert to CSV with header and robust escaping
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

                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');

                  // Build filename
                  let filename = 'events.csv';
                  if (showVirtual) {
                    filename = 'virtual_events.csv';
                  } else if (selectedCity || city) {
                    const targetCity = selectedCity || city!;
                    const cityPart = (targetCity.city || 'Statewide').replace(/[^a-z0-9]/gi, '_');
                    filename = `${cityPart}_${targetCity.state}_events.csv`;
                  } else if (cluster && cluster.length > 0) {
                    filename = `cluster_${cluster.length}_cities_events.csv`;
                  }

                  a.href = url;
                  a.download = filename;
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
              className="btn-primary w-full flex items-center justify-center text-sm disabled:opacity-60"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
