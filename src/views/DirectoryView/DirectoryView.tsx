import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useFiltersStore } from '../../state/filtersStore';
import { analyticsClient } from '../../api/analyticsClient';
import { FilterPanel } from '../../components/FilterPanel/FilterPanel';
import { EventCard } from '../../components/EventCard/EventCard';
import { SearchBar } from '../../components/SearchBar/SearchBar';
import type { EventSummary, Cursor } from '../../api/types';

export const DirectoryView: React.FC = () => {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<Cursor | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false); // Hidden by default on mobile
  
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  const { filters, isApplying, networkExpanded, expandedActorIds } = useFiltersStore();
  const prevSearchRef = useRef(filters.search);

  // Build effective filters (include network expansion when enabled)
  const effectiveFilters = useMemo(() => {
    if (networkExpanded && expandedActorIds && expandedActorIds.length > 0) {
      return { ...filters, actor_ids: expandedActorIds } as typeof filters;
    }
    return filters;
  }, [filters, networkExpanded, expandedActorIds]);

  // Stable key for deep filter changes
  const filtersKey = useMemo(() => JSON.stringify(effectiveFilters), [effectiveFilters]);
  const prevFiltersKeyRef = useRef<string | null>(null);

  // Load events when filters change (deep compare)
  useEffect(() => {
    console.log('DirectoryView: Filters changed:', effectiveFilters);
    console.log('DirectoryView: isApplying:', isApplying);
    console.log('DirectoryView: Has search?', effectiveFilters.search ? 'Yes' : 'No');
    const prevKey = prevFiltersKeyRef.current;
    prevFiltersKeyRef.current = filtersKey;

    if (prevKey && prevKey === filtersKey) {
      // No deep change, skip
      return;
    }

    // Check if search changed specifically
    const searchChanged = prevSearchRef.current !== effectiveFilters.search;
    if (searchChanged) {
      console.log('DirectoryView: Search changed, forcing reload');
      prevSearchRef.current = effectiveFilters.search;
    }
    
    // Always reload when filters change - the isApplying flag shouldn't block directory refresh
    console.log('DirectoryView: Reloading events due to filter change');
    setEvents([]);
    setCursor(undefined);
    setHasMore(false);
    loadEvents(true);
  }, [filtersKey]);

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
  }, [hasMore, loading, cursor]);

  const loadEvents = async (isInitial: boolean) => {
    if (loading) return;
    
    console.log('DirectoryView: Loading events with filters:', effectiveFilters);
    console.log('DirectoryView: Has search?', effectiveFilters.search ? 'Yes' : 'No');
    
    setLoading(true);
    setError(null);

    try {
      const response = await analyticsClient.getDirectoryEvents(
        effectiveFilters,
        100,
        isInitial ? undefined : cursor
      );

      const mergeAndSort = (prevList: EventSummary[], nextList: EventSummary[]) => {
        const byId = new Map<string, EventSummary>();
        // Keep latest occurrence by event_date
        for (const e of [...prevList, ...nextList]) {
          const existing = byId.get(e.id);
          if (!existing) {
            byId.set(e.id, e);
          } else {
            // Replace if the new one is more recent or equal but comes later
            if (new Date(e.date).getTime() >= new Date(existing.date).getTime()) {
              byId.set(e.id, e);
            }
          }
        }
        // Sort descending by date, then by id to stabilize
        const merged = Array.from(byId.values()).sort((a, b) => {
          const da = new Date(a.date).getTime();
          const db = new Date(b.date).getTime();
          if (db !== da) return db - da;
          return (b.id || '').localeCompare(a.id || '');
        });
        return merged;
      };

      if (isInitial) {
        setEvents(mergeAndSort([], response.events));
        setTotalCount(response.total_count);
      } else {
        setEvents(prev => mergeAndSort(prev, response.events));
      }
      
      setCursor(response.next_cursor);
      setHasMore(response.has_more);
    } catch (err: any) {
      setError(err.message || 'Failed to load events');
      console.error('Error loading directory events:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const rows: any = await analyticsClient.exportEvents({
        scope: 'map',
        scope_params: {},
        filters
      });

      // Normalize rows and expand post_urls into separate columns
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
          // Fallback header for array rows
          header = ['event_id','event_date','event_name','city','state','tags','actor_names','post_urls'];
          dataRows = rows as any[][];
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
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `events-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  return (
    <div className="h-full flex">
      {/* Filter Panel */}
      <FilterPanel 
        className={`${showFilters ? 'w-full md:w-80' : 'w-0'} h-full md:relative fixed top-16 bottom-0 left-0 z-40 md:z-10 md:top-0 md:bottom-auto transition-all duration-300 overflow-hidden flex-shrink-0`}
        onClose={() => setShowFilters(false)}
      />
      
      {/* Filter Panel Backdrop (Mobile) */}
      {showFilters && (
        <div 
          className="fixed inset-0 top-16 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setShowFilters(false)}
        />
      )}
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-3 md:px-6 py-2 md:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 md:space-x-4 flex-1 min-w-0">
              {!showFilters && (
                <button
                  onClick={() => setShowFilters(true)}
                  className="p-2 hover:bg-gray-100 rounded-lg touch-manipulation flex-shrink-0"
                  style={{ minHeight: '40px', minWidth: '40px' }}
                >
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-base md:text-xl font-semibold text-gray-900 truncate">Event Directory</h1>
                <p className="text-xs text-gray-500">
                  {totalCount.toLocaleString()} events
                </p>
              </div>
            </div>
            <button
              onClick={handleExport}
              className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center touch-manipulation text-xs md:text-base flex-shrink-0"
              style={{ minHeight: '36px' }}
            >
              <svg className="w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden md:inline">Export CSV</span>
              <span className="md:hidden">Export</span>
            </button>
          </div>
        </div>
        
        {/* Search Bar */}
        <div className="bg-white border-b border-gray-200 px-3 md:px-6 py-2">
          <SearchBar 
            placeholder="Search events by topic, description, or context..."
            className="max-w-full md:max-w-2xl text-sm"
          />
        </div>

        {/* Events List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 -webkit-overflow-scrolling-touch">
          {error ? (
            <div className="p-3 md:p-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700">{error}</p>
                <button
                  onClick={() => loadEvents(true)}
                  className="mt-2 text-sm text-red-600 hover:text-red-800 underline touch-manipulation"
                  style={{ minHeight: '44px' }}
                >
                  Try again
                </button>
              </div>
            </div>
          ) : events.length === 0 && !loading ? (
            <div className="p-3 md:p-6 text-center text-gray-500">
              <div className="text-sm">No events found matching your filters</div>
            </div>
          ) : (
            <div className="w-full md:max-w-4xl md:mx-auto p-3 md:p-6 space-y-2 md:space-y-3" style={{ boxSizing: 'border-box' }}>
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
              
              {/* Loading indicator */}
              {loading && events.length > 0 && hasMore && (
                <div className="py-4 md:py-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 md:h-8 md:w-8 border-b-2 border-blue-600"></div>
                  <p className="mt-1 text-xs md:text-sm text-gray-600">Loading more events...</p>
                </div>
              )}
              
              {/* Initial loading */}
              {loading && events.length === 0 && (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2 mb-1"></div>
                      <div className="h-3 bg-gray-200 rounded w-full"></div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Load more trigger */}
              {hasMore && !loading && (
                <div ref={loadMoreRef} className="py-4 md:py-8 text-center">
                  <button
                    onClick={() => loadEvents(false)}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Load more events
                  </button>
                </div>
              )}
              
              {/* End of list */}
              {!hasMore && events.length > 0 && (
                <div className="py-4 md:py-8 text-center text-gray-500">
                  <p className="text-sm">End of results</p>
                  <p className="text-xs mt-1">Showing all {events.length} of {totalCount} events</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
