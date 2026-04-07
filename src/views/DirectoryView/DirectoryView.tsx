import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useFiltersStore } from '../../state/filtersStore';
import { analyticsClient } from '../../api/analyticsClient';
import { FilterPanel } from '../../components/FilterPanel/FilterPanel';
import { EventCard } from '../../components/EventCard/EventCard';
import type { EventSummary, Cursor } from '../../api/types';

// fieldnotes palette: page #f6f1e6, surface #fdfaf2, ink #1a1a1a, muted #6b6b6b, accent #c2410c

export const DirectoryView: React.FC = () => {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<Cursor | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { filters, isApplying, setFilter, applyFilters, networkExpanded, expandedActorIds } =
    useFiltersStore();
  const prevSearchRef = useRef(filters.search);

  // Sync local search input with store
  useEffect(() => {
    setSearchValue(filters.search ?? '');
  }, [filters.search]);

  // Build effective filters (include network expansion when enabled)
  const effectiveFilters = useMemo(() => {
    if (networkExpanded && expandedActorIds && expandedActorIds.length > 0) {
      return { ...filters, actor_ids: expandedActorIds } as typeof filters;
    }
    return filters;
  }, [filters, networkExpanded, expandedActorIds]);

  const filtersKey = useMemo(() => JSON.stringify(effectiveFilters), [effectiveFilters]);
  const prevFiltersKeyRef = useRef<string | null>(null);

  // Reload when filters change
  useEffect(() => {
    const prevKey = prevFiltersKeyRef.current;
    prevFiltersKeyRef.current = filtersKey;

    if (prevKey && prevKey === filtersKey) return;

    const searchChanged = prevSearchRef.current !== effectiveFilters.search;
    if (searchChanged) prevSearchRef.current = effectiveFilters.search;

    setEvents([]);
    setCursor(undefined);
    setHasMore(false);
    loadEvents(true);
  }, [filtersKey]);

  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) loadEvents(false);
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) observerRef.current.observe(loadMoreRef.current);

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [hasMore, loading, cursor]);

  const loadEvents = async (isInitial: boolean) => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const response = await analyticsClient.getDirectoryEvents(
        effectiveFilters,
        100,
        isInitial ? undefined : cursor,
      );

      const mergeAndSort = (prevList: EventSummary[], nextList: EventSummary[]) => {
        const byId = new Map<string, EventSummary>();
        for (const e of [...prevList, ...nextList]) {
          const existing = byId.get(e.id);
          if (!existing) {
            byId.set(e.id, e);
          } else if (new Date(e.date).getTime() >= new Date(existing.date).getTime()) {
            byId.set(e.id, e);
          }
        }
        return Array.from(byId.values()).sort((a, b) => {
          const da = new Date(a.date).getTime();
          const db = new Date(b.date).getTime();
          if (db !== da) return db - da;
          return (b.id || '').localeCompare(a.id || '');
        });
      };

      if (isInitial) {
        setEvents(mergeAndSort([], response.events));
        setTotalCount(response.total_count);
      } else {
        setEvents((prev) => mergeAndSort(prev, response.events));
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
        filters,
      });

      let header: string[] = [];
      let dataRows: any[][] = [];
      if (Array.isArray(rows) && rows.length > 0) {
        if (typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
          const objRows = rows as any[];
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
          dataRows = objRows.map((r) => {
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
        } else if (Array.isArray(rows[0])) {
          header = ['event_id', 'event_date', 'event_name', 'city', 'state', 'tags', 'actor_names', 'post_urls'];
          dataRows = rows as any[][];
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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter('search', searchValue);
    applyFilters();
  };

  // One-line sentence: "65 events this month · ≥ 50% confidence · az, ca · campus, divest"
  const headerSentence = useMemo(() => {
    const parts: string[] = [];

    const count = totalCount.toLocaleString();
    const periodPhrase =
      filters.period === 'today'
        ? 'today'
        : filters.period === 'week'
        ? 'this week'
        : filters.period === 'month'
        ? 'this month'
        : filters.period === 'year'
        ? 'this year'
        : null;

    parts.push(periodPhrase ? `${count} events ${periodPhrase}` : `${count} events`);

    if (filters.confidence && filters.confidence > 0) {
      parts.push(`≥ ${Math.round(filters.confidence * 100)}% confidence`);
    }
    if (filters.states && filters.states.length > 0) {
      parts.push(
        filters.states.slice(0, 3).join(', ').toLowerCase() +
          (filters.states.length > 3 ? '…' : ''),
      );
    }
    if (filters.tags && filters.tags.length > 0) {
      const tagLabels = filters.tags
        .slice(0, 2)
        .map((t) => t.split(':').pop())
        .join(', ');
      parts.push(tagLabels + (filters.tags.length > 2 ? ` +${filters.tags.length - 2}` : ''));
    }

    return parts.join(' · ');
  }, [filters, totalCount]);

  return (
    <div className="h-full flex bg-[#f6f1e6]">
      {/* Filter Panel */}
      <FilterPanel
        className={`${showFilters ? 'w-full md:w-80' : 'w-0'} h-full md:relative fixed top-16 bottom-0 left-0 z-40 md:z-10 md:top-0 md:bottom-auto transition-all duration-300 overflow-hidden flex-shrink-0`}
        onClose={() => setShowFilters(false)}
      />

      {/* Mobile backdrop */}
      {showFilters && (
        <div
          className="fixed inset-0 top-16 bg-black/40 z-30 md:hidden"
          onClick={() => setShowFilters(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#f6f1e6]">
        {/* Hero — single compact line */}
        <div className="px-4 md:px-8 pt-5 md:pt-6 pb-3 border-b border-black/[0.08] bg-[#f6f1e6]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {!showFilters && (
                <button
                  onClick={() => setShowFilters(true)}
                  className="p-1.5 hover:bg-[#ede5d2] rounded-md touch-manipulation flex-shrink-0 text-[#2a2a2a]"
                  title="show filters"
                  style={{ minHeight: 32, minWidth: 32 }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                </button>
              )}
              <p className="text-[13px] text-[#2a2a2a] truncate">
                <span className="font-medium text-[#1a1a1a]">{headerSentence.split(' · ')[0]}</span>
                {headerSentence.includes(' · ') && (
                  <span className="text-[#6b6b6b]"> · {headerSentence.split(' · ').slice(1).join(' · ')}</span>
                )}
              </p>
            </div>
            <button
              onClick={handleExport}
              className="px-2.5 py-1.5 text-[11px] md:text-xs font-medium text-[#2a2a2a] bg-[#fdfaf2] border border-black/[0.12] hover:bg-[#ede5d2] transition-colors flex items-center gap-1 flex-shrink-0"
              style={{ minHeight: 30, borderRadius: 6 }}
            >
              <span>csv</span>
              <span aria-hidden>↓</span>
            </button>
          </div>

          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="mt-3">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#9a9a9a]">
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197M16.803 15.803A7.5 7.5 0 1 0 5.196 5.197a7.5 7.5 0 0 0 11.607 10.606Z" />
                </svg>
              </span>
              <input
                type="search"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="search events by topic, description, or context…"
                className="w-full max-w-2xl bg-[#fdfaf2] border border-black/[0.12] py-2 pl-9 pr-3 text-[13px] text-[#1a1a1a] placeholder:text-[#9a9a9a] focus:border-[#c2410c]/40 focus:outline-none focus:ring-2 focus:ring-[#c2410c]/15"
                style={{ borderRadius: 6 }}
              />
            </div>
          </form>
        </div>

        {/* Events list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#f6f1e6] scrollbar-thin">
          {error ? (
            <div className="p-4 md:p-6">
              <div className="bg-[#fdf2ed] border border-[rgba(194,65,12,0.2)] rounded-md p-4 max-w-2xl">
                <p className="text-sm text-[#9a330a]">{error}</p>
                <button
                  onClick={() => loadEvents(true)}
                  className="mt-2 text-xs text-[#c2410c] hover:text-[#9a330a] underline touch-manipulation"
                  style={{ minHeight: 32 }}
                >
                  try again
                </button>
              </div>
            </div>
          ) : events.length === 0 && !loading ? (
            <div className="p-10 text-center text-[#6b6b6b]">
              <div className="text-sm">no events match your filters.</div>
              <div className="text-xs mt-1 text-[#9a9a9a]">try widening the date range or clearing tags.</div>
            </div>
          ) : (
            <div className="w-full md:max-w-3xl md:mx-auto p-4 md:p-6 space-y-2.5">
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

              {loading && events.length > 0 && hasMore && (
                <div className="py-6 text-center">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-[#c2410c] border-t-transparent"></div>
                  <p className="mt-1.5 text-xs text-[#6b6b6b]">loading more…</p>
                </div>
              )}

              {loading && events.length === 0 && (
                <div className="space-y-2.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="bg-[#fdfaf2] border border-black/[0.1] rounded-md p-4 animate-pulse"
                    >
                      <div className="h-4 bg-[#ede5d2] rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-[#ede5d2] rounded w-1/2 mb-1.5"></div>
                      <div className="h-3 bg-[#ede5d2] rounded w-full"></div>
                    </div>
                  ))}
                </div>
              )}

              {hasMore && !loading && (
                <div ref={loadMoreRef} className="py-6 text-center">
                  <button
                    onClick={() => loadEvents(false)}
                    className="text-xs font-medium text-[#c2410c] hover:text-[#9a330a]"
                  >
                    load more events
                  </button>
                </div>
              )}

              {!hasMore && events.length > 0 && (
                <div className="py-6 text-center text-[#6b6b6b]">
                  <p className="text-xs">end of results · {events.length.toLocaleString()} of {totalCount.toLocaleString()}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
