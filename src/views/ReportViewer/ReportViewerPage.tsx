import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EventCard } from '../../components/EventCard/EventCard';
import { SidePanel } from '../../components/SidePanel/SidePanel';
import { SocialPostCard, type SocialPost } from '../../components/SocialPostCard/SocialPostCard';
import { ActorPostsList } from '../../components/ActorPostsList/ActorPostsList';
import { analyticsClient } from '../../api/analyticsClient';
import type { Filters, MapPointsResponse, EventSummary, Cursor } from '../../api/types';
import {
  MAPBOX_STYLE,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  CLUSTER_PAINT,
  UNCLUSTERED_PAINT,
  MAPBOX_ENABLED,
  getMapBounds,
  pointsToGeoJSON
} from '../../lib/mapboxConfig';

interface ReportData {
  run_id: string;
  job_name: string;
  report_start_date: string;
  report_end_date: string;
  gemini_summary: string;
  event_count: number;
  statistics: {
    total_events: number;
    cities: Array<{ name: string; count: number }>;
    states: Array<{ name: string; count: number }>;
    top_people: Array<{ name: string; count: number }>;
    top_chapters: Array<{ name: string; count: number }>;
    top_organizations: Array<{ name: string; count: number }>;
    // Extended stats - may or may not be present
    universities?: Array<{ name: string; count: number }>;
    churches?: Array<{ name: string; count: number }>;
    categories?: Array<{ name: string; count: number }>;
    lobbying_topics?: Array<{ name: string; count: number }>;
    category_subtypes?: Record<string, Array<{ name: string; count: number }>>;
  };
  search_filters: any;
  created_at: string;
  events?: Array<{
    id: string;
    event_name: string;
    event_description?: string;
    event_date: string;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;
  // Social media data
  social_insights?: string | null;
  social_posts?: SocialPost[];
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface StatRowProps {
  name: string;
  count: number;
  maxCount: number;
  color?: 'blue' | 'purple' | 'amber' | 'emerald' | 'rose' | 'cyan';
}

const StatRow: React.FC<StatRowProps> = ({ name, count, maxCount, color = 'blue' }) => {
  const percentage = (count / maxCount) * 100;
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
    cyan: 'bg-cyan-500'
  };
  
  return (
    <div className="flex items-center gap-3 py-1.5 group">
      <span className="text-gray-700 text-sm flex-1 truncate group-hover:text-gray-900 transition-colors min-w-0">{name}</span>
      <div className="w-20 sm:w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div 
          className={`h-full ${colorClasses[color]} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-500 w-10 text-right flex-shrink-0 tabular-nums">{count}</span>
    </div>
  );
};

interface StatCategoryProps {
  title: string;
  items: Array<{ name: string; count: number }>;
  color?: 'blue' | 'purple' | 'amber' | 'emerald' | 'rose' | 'cyan';
  defaultExpanded?: boolean;
}

const StatCategory: React.FC<StatCategoryProps> = ({ title, items, color = 'blue', defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const maxCount = items[0]?.count || 1;

  const dotColorClass: Record<string, string> = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
    cyan: 'bg-cyan-500'
  };
  
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColorClass[color]}`}></span>
          <span className="font-semibold text-gray-900 text-sm">{title}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{items.length}</span>
        </div>
        <svg 
          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isExpanded && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <div className="pt-2 space-y-0.5">
            {items.slice(0, 8).map((item, i) => (
              <StatRow key={i} name={item.name} count={item.count} maxCount={maxCount} color={color} />
            ))}
            {items.length > 8 && (
              <p className="text-xs text-gray-400 pt-2">+{items.length - 8} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ReportViewerPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab navigation state
  const [activeSection, setActiveSection] = useState<'overview' | 'stats' | 'social' | 'feed'>('overview');

  // Social Feed (formerly Actor Explorer) state
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);

  // Map state
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapData, setMapData] = useState<MapPointsResponse | null>(null);
  const [selectedCity, setSelectedCity] = useState<{ city: string; state: string } | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Array<{ city: string; state: string }> | null>(null);
  const [showVirtualEvents, setShowVirtualEvents] = useState(false);
  const [virtualEventsCount, setVirtualEventsCount] = useState(0);
  const MAP_AVAILABLE = MAPBOX_ENABLED;
  const [viewMode, setViewMode] = useState<'map' | 'list'>(MAP_AVAILABLE ? 'map' : 'list');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsCursor, setEventsCursor] = useState<Cursor | undefined>(undefined);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [directoryTotalCount, setDirectoryTotalCount] = useState<number | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const eventsRef = useRef<EventSummary[]>([]);

  // Fetch report metadata
  useEffect(() => {
    if (!token) return;

    const fetchReport = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/email-reports/viewer?token=${encodeURIComponent(token)}`);
        if (!response.ok) throw new Error('Report not found');

        const data = await response.json();
        setReport(data.report);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [token]);

  // Build filters from report (same format as MapView/DirectoryView)
  const reportFilters = useMemo<Filters | null>(() => {
    if (!report) return null;

    return {
      ...report.search_filters,
      date_range: {
        start_date: report.report_start_date,
        end_date: report.report_end_date
      }
    } as Filters;
  }, [report]);

  // Load map data function (same pattern as MapView)
  const buildFallbackMapData = () => {
    if (!report?.events || report.events.length === 0) return null;

    const grouped = new Map<string, {
      city: string;
      state: string;
      lat: number;
      lon: number;
      count: number;
    }>();

    for (const event of report.events) {
      const lat = typeof event.latitude === 'number' ? event.latitude : Number(event.latitude);
      const lon = typeof event.longitude === 'number' ? event.longitude : Number(event.longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!event.state) continue;

      const city = event.city || '';
      const key = `${city}|${event.state}`;

      const entry = grouped.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        grouped.set(key, {
          city,
          state: event.state,
          lat,
          lon,
          count: 1
        });
      }
    }

    const mapPoints = Array.from(grouped.values());
    if (mapPoints.length === 0) return null;

    return {
      total_events: report.event_count ?? mapPoints.reduce((sum, point) => sum + point.count, 0),
      map_points: mapPoints
    } satisfies MapPointsResponse;
  };

  const applyMapDataToSource = (data: MapPointsResponse, retryCount: number) => {
    if (!MAP_AVAILABLE) return;
    if (!map.current) return;

    if (map.current.isStyleLoaded()) {
      const source = map.current.getSource('events') as mapboxgl.GeoJSONSource;
      if (source) {
        const geoJSON = pointsToGeoJSON(data.map_points);
        source.setData(geoJSON);

        const validPoints = data.map_points.filter(p => p.lat !== null && p.lon !== null);
        if (validPoints.length > 0) {
          const bounds = getMapBounds(validPoints);
          if (bounds) {
            map.current.fitBounds(bounds, { padding: 50 });
          }
        }
      } else if (retryCount < 10) {
        setTimeout(() => applyMapDataToSource(data, retryCount + 1), 500);
      }
    } else if (retryCount < 10) {
      setTimeout(() => applyMapDataToSource(data, retryCount + 1), 500);
    }
  };

  const loadMapData = async (retryCount = 0) => {
    if (!MAP_AVAILABLE) return;
    if (!reportFilters) return;

    if (retryCount > 10) {
      setMapLoading(false);
      return;
    }

    setMapLoading(true);

    try {
      const data = await analyticsClient.getMapPoints(reportFilters);
      setMapData(data);
      applyMapDataToSource(data, retryCount);

      // Calculate virtual/non-geocoded events
      const geocodedSum = data.map_points.reduce((sum, p) => sum + (p.count || 0), 0);
      const virtualCount = Math.max(0, (data.total_events || 0) - geocodedSum);
      setVirtualEventsCount(virtualCount);

      if ((!data.map_points || data.map_points.length === 0) && report?.events?.length) {
        const fallback = buildFallbackMapData();
        if (fallback) {
          setMapData(fallback);
          applyMapDataToSource(fallback, retryCount);
          // Recalculate for fallback data
          const fallbackGeocodedSum = fallback.map_points.reduce((sum, p) => sum + (p.count || 0), 0);
          const fallbackVirtualCount = Math.max(0, (fallback.total_events || 0) - fallbackGeocodedSum);
          setVirtualEventsCount(fallbackVirtualCount);
        }
      }
    } catch (err: any) {
      const fallback = buildFallbackMapData();
      if (fallback) {
        setMapData(fallback);
        applyMapDataToSource(fallback, retryCount);
        // Calculate for fallback data
        const fallbackGeocodedSum = fallback.map_points.reduce((sum, p) => sum + (p.count || 0), 0);
        const fallbackVirtualCount = Math.max(0, (fallback.total_events || 0) - fallbackGeocodedSum);
        setVirtualEventsCount(fallbackVirtualCount);
      }
    } finally {
      setMapLoading(false);
    }
  };

  const loadEvents = useCallback(async (isInitial: boolean) => {
    if (!reportFilters || eventsLoading) return;

    setEventsLoading(true);
    setEventsError(null);

    const desiredBatch = 50;
    const mergeAndSort = (prevList: EventSummary[], nextList: EventSummary[]) => {
      const byId = new Map<string, EventSummary>();
      for (const entry of [...prevList, ...nextList]) {
        const existing = byId.get(entry.id);
        if (!existing) {
          byId.set(entry.id, entry);
        } else {
          const existingDate = new Date(existing.date).getTime();
          const entryDate = new Date(entry.date).getTime();
          if (entryDate >= existingDate) {
            byId.set(entry.id, entry);
          }
        }
      }

      return Array.from(byId.values()).sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (db !== da) return db - da;
        return (b.id || '').localeCompare(a.id || '');
      });
    };

    try {
      let workingEvents = isInitial ? [] : [...eventsRef.current];
      let accumulated = 0;
      let nextCursor = isInitial ? undefined : eventsCursor;
      let hasMore = false;
      let lastCursor = nextCursor;
      let lastTotalCount: number | null = null;

      for (let attempts = 0; attempts < 15; attempts += 1) {
        const response = await analyticsClient.getDirectoryEvents(
          reportFilters,
          desiredBatch,
          nextCursor
        );

        if (typeof response.total_count === 'number') {
          lastTotalCount = response.total_count;
        }

        const prevLength = workingEvents.length;
        workingEvents = mergeAndSort(workingEvents, response.events);
        accumulated += Math.max(0, workingEvents.length - prevLength);

        hasMore = Boolean(response.has_more);
        lastCursor = response.next_cursor;
        nextCursor = response.next_cursor;

        if (!hasMore || !nextCursor || accumulated >= desiredBatch) {
          break;
        }
      }

      setEvents(workingEvents);
      if (lastTotalCount !== null) {
        setDirectoryTotalCount(lastTotalCount);
      }
      setEventsCursor(lastCursor);
      setEventsHasMore(hasMore);
    } catch (err: any) {
      setEventsError(err.message || 'Failed to load events');
    } finally {
      setEventsLoading(false);
    }
  }, [reportFilters, eventsLoading, eventsCursor]);

  // Initialize map
  useEffect(() => {
    if (!MAP_AVAILABLE) return;
    if (!mapContainer.current || map.current) return;
    if (activeSection !== 'overview') return;
    if (viewMode !== 'map') return;

    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: MAPBOX_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM
      });

      map.current.on('load', () => {
        map.current!.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.current!.addSource('events', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50
        });

        map.current!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: CLUSTER_PAINT
        });

        map.current!.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          paint: UNCLUSTERED_PAINT
        });

        // Click handlers
        map.current!.on('click', 'clusters', (e) => {
          const features = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] });
          if (!features || features.length === 0) return;

          const clusterId = features[0].properties?.cluster_id;
          const source = map.current!.getSource('events') as mapboxgl.GeoJSONSource;

          source.getClusterLeaves(clusterId, 100, 0, (err, leaves) => {
            if (err || !leaves) {
              source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                const coordinates = (features[0].geometry as any).coordinates;
                map.current!.easeTo({ center: coordinates, zoom: zoom ?? 12 });
              });
              return;
            }

            const leafFeatures = (leaves as any).features || leaves;
            const cities = (Array.isArray(leafFeatures) ? leafFeatures : []).map((f: any) => ({
              city: f.properties?.city || '',
              state: f.properties?.state
            })).filter((c: any) => c.state);

            if (cities.length > 0) {
              setSelectedCluster(cities);
              setSelectedCity(null);
            } else {
              source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                const coordinates = (features[0].geometry as any).coordinates;
                map.current!.easeTo({ center: coordinates, zoom: (zoom ?? 11) + 1 });
              });
            }
          });
        });

        map.current!.on('click', 'unclustered-point', (e) => {
          const properties = e.features![0].properties;
          if (properties?.state) {
            setSelectedCity({ city: properties.city || '', state: properties.state });
            setSelectedCluster(null);
          }
        });

        map.current!.on('mouseenter', 'clusters', () => map.current!.getCanvas().style.cursor = 'pointer');
        map.current!.on('mouseleave', 'clusters', () => map.current!.getCanvas().style.cursor = '');
        map.current!.on('mouseenter', 'unclustered-point', () => map.current!.getCanvas().style.cursor = 'pointer');
        map.current!.on('mouseleave', 'unclustered-point', () => map.current!.getCanvas().style.cursor = '');

        loadMapData();
      });
    } catch (err) {
      console.error('Failed to initialize map:', err);
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [viewMode, activeSection]);

  // Load map data when filters ready
  useEffect(() => {
    if (map.current && reportFilters) {
      loadMapData();
    }
  }, [reportFilters]);

  useEffect(() => {
    if (!reportFilters) return;
    setEvents([]);
    setEventsCursor(undefined);
    setEventsHasMore(false);
    setDirectoryTotalCount(null);
    setExpandedEventId(null);
    setEventsError(null);
  }, [reportFilters]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (viewMode !== 'list' || activeSection !== 'overview') {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      return;
    }

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && eventsHasMore && !eventsLoading) {
          loadEvents(false);
        }
      },
      { threshold: 0.1 }
    );

    const target = loadMoreRef.current;
    if (target) {
      observerRef.current.observe(target);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [viewMode, activeSection, eventsHasMore, eventsLoading, loadEvents]);

  useEffect(() => {
    if (viewMode !== 'list' || activeSection !== 'overview') return;
    if (!reportFilters) return;
    if (events.length > 0 || eventsLoading) return;

    loadEvents(true);
  }, [viewMode, activeSection, reportFilters, events.length, eventsLoading, loadEvents]);

  useEffect(() => {
    if (!MAP_AVAILABLE) return;
    if (viewMode !== 'map' || activeSection !== 'overview') return;

    const timeout = setTimeout(() => {
      map.current?.resize();
    }, 250);

    return () => clearTimeout(timeout);
  }, [viewMode, activeSection, MAP_AVAILABLE]);

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const formatDateRange = () => {
    if (!report) return '';
    const start = new Date(report.report_start_date);
    const end = new Date(report.report_end_date);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  // ============================================================================
  // LOADING / ERROR STATES
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading report...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Report Not Found</h1>
          <p className="text-gray-600">{error || 'This report does not exist.'}</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // DERIVED DATA
  // ============================================================================

  const stats = report.statistics;
  const totalEventsDisplay = mapData?.total_events ?? directoryTotalCount ?? report.event_count ?? report.events?.length ?? 0;
  const directoryCountLabel = (directoryTotalCount ?? totalEventsDisplay).toLocaleString();

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wider mb-1">Intelligence Report</p>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{report.job_name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{formatDateRange()}</p>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
              <div className="text-center sm:text-right">
                <p className="text-2xl sm:text-3xl font-bold text-gray-900">{totalEventsDisplay.toLocaleString()}</p>
                <p className="text-xs text-gray-500">events tracked</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Tab Navigation */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-0 border-t border-gray-100 -mb-px overflow-x-auto">
            {[
              { id: 'overview' as const, label: 'Overview', icon: '📊' },
              { id: 'stats' as const, label: 'Stats', icon: '📈' },
              { id: 'social' as const, label: 'Social', icon: '💬' },
              { id: 'feed' as const, label: 'Social Feed', icon: '📱' }
            ].map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeSection === section.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span className="hidden sm:inline">{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        
        {/* ================================================================== */}
        {/* OVERVIEW TAB */}
        {/* ================================================================== */}
        {activeSection === 'overview' && (
          <div className="space-y-6 sm:space-y-8">
            {/* Executive Summary */}
            <section className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-8">
              <div className="flex items-center gap-3 mb-4 sm:mb-6">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">Executive Summary</h2>
                <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full hidden sm:inline">Gemini AI</span>
              </div>
              <div className="prose prose-sm sm:prose-base prose-gray max-w-none prose-headings:font-bold prose-headings:text-gray-900 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-3 prose-p:text-gray-700 prose-p:leading-relaxed prose-ul:my-2 prose-li:my-0.5 prose-strong:text-gray-900">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {report.gemini_summary}
                </ReactMarkdown>
              </div>
            </section>

            {/* Social Media Summary */}
            {report.social_insights && (
              <section className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-3 mb-4 sm:mb-6">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900">Social Media Summary</h2>
                  <span className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 text-xs font-semibold">BETA</span>
                </div>
                <div className="prose prose-sm sm:prose-base prose-gray max-w-none prose-headings:font-bold prose-headings:text-gray-900 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-3 prose-p:text-gray-700 prose-p:leading-relaxed prose-ul:my-2 prose-li:my-0.5 prose-strong:text-gray-900">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {report.social_insights}
                  </ReactMarkdown>
                </div>
              </section>
            )}

            {/* Condensed Stats Grid */}
            <section className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
              {/* Total Events Header */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-100">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Events</p>
                  <p className="text-3xl sm:text-4xl font-bold text-gray-900">{totalEventsDisplay.toLocaleString()}</p>
                </div>
                <button 
                  onClick={() => setActiveSection('stats')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  View all stats →
                </button>
              </div>

              {/* Stats Grid - Tight Layout */}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-6">
                {/* Top Cities */}
                {stats.cities && stats.cities.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Cities <span className="text-gray-300">({stats.cities.length})</span>
                    </h3>
                    <div className="space-y-1.5">
                      {stats.cities.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-700 truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-emerald-600 tabular-nums">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Universities */}
                {stats.universities && stats.universities.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      Universities
                    </h3>
                    <div className="space-y-1.5">
                      {stats.universities.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-700 truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-blue-600 tabular-nums">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Churches */}
                {stats.churches && stats.churches.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                      Churches
                    </h3>
                    <div className="space-y-1.5">
                      {stats.churches.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-700 truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-purple-600 tabular-nums">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top People */}
                {stats.top_people && stats.top_people.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      People
                    </h3>
                    <div className="space-y-1.5">
                      {stats.top_people.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-700 truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-amber-600 tabular-nums">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Categories */}
                {stats.categories && stats.categories.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      Categories
                    </h3>
                    <div className="space-y-1.5">
                      {stats.categories.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-700 truncate">{item.name}</span>
                          <span className="text-xs font-semibold text-rose-600 tabular-nums">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Activity Map/List Module */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900">Activity</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {totalEventsDisplay.toLocaleString()} events across {stats.cities?.length || 0} cities
                  </p>
                </div>
                <div className="flex p-1 bg-gray-100 rounded-xl self-start">
                  <button 
                    onClick={() => MAP_AVAILABLE && setViewMode('map')}
                    disabled={!MAP_AVAILABLE}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      viewMode === 'map' 
                        ? 'bg-white shadow-sm text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700'
                    } ${!MAP_AVAILABLE ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Map
                  </button>
                  <button 
                    onClick={() => setViewMode('list')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      viewMode === 'list' 
                        ? 'bg-white shadow-sm text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    List
                  </button>
                </div>
              </div>

              {/* Map View */}
              {MAP_AVAILABLE && viewMode === 'map' && (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden relative">
                  <div ref={mapContainer} className="h-[50vh] sm:h-[60vh] w-full" />

                  {/* Virtual/Non-geocoded Events Button */}
                  {virtualEventsCount > 0 && (
                    <div className="absolute top-4 right-4 z-10">
                      <button
                        onClick={() => {
                          setShowVirtualEvents(true);
                          setSelectedCity(null);
                          setSelectedCluster(null);
                        }}
                        className="bg-amber-50 border border-amber-300 text-amber-700 rounded-lg shadow-lg hover:bg-amber-100 transition-colors flex items-center space-x-2 px-4 py-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span className="font-medium text-sm">Non-geocoded</span>
                        <span className="bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full text-xs font-bold">
                          {virtualEventsCount}
                        </span>
                      </button>
                    </div>
                  )}

                  {mapLoading && (
                    <div className="absolute inset-0 z-20 bg-white/75 flex items-center justify-center">
                      <div className="text-center">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p className="mt-2 text-sm text-gray-600">Loading map data...</p>
                      </div>
                    </div>
                  )}

                  {reportFilters && (
                    <SidePanel
                      city={selectedCity}
                      cluster={selectedCluster}
                      showVirtual={showVirtualEvents}
                      filters={reportFilters}
                      onClose={() => {
                        setSelectedCity(null);
                        setSelectedCluster(null);
                        setShowVirtualEvents(false);
                      }}
                    />
                  )}
                </div>
              )}

              {/* List View */}
              {viewMode === 'list' && (
                <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6">
                  <div className="mb-4">
                    <p className="text-sm text-gray-500">
                      Showing {events.length.toLocaleString()} of {directoryCountLabel} events
                    </p>
                  </div>

                  {eventsError && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {eventsError}
                    </div>
                  )}

                  <div className="space-y-4">
                    {events.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        isExpanded={expandedEventId === event.id}
                        onToggleExpand={() =>
                          setExpandedEventId((prev) => (prev === event.id ? null : event.id))
                        }
                      />
                    ))}

                    {eventsLoading && events.length === 0 && (
                      <div className="flex justify-center py-6">
                        <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                      </div>
                    )}

                    {!eventsLoading && events.length === 0 && !eventsError && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-600">
                        No events found for this report.
                      </div>
                    )}

                    {eventsLoading && events.length > 0 && (
                      <div className="flex justify-center py-4">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
                      </div>
                    )}

                    {eventsHasMore && !eventsLoading && (
                      <div className="py-4 text-center text-sm text-gray-500">
                        Scroll to load more events…
                      </div>
                    )}

                    <div ref={loadMoreRef} className="h-1" />
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================================================================== */}
        {/* STATS TAB */}
        {/* ================================================================== */}
        {activeSection === 'stats' && (
          <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Statistics</h2>
                <p className="text-sm text-gray-500 mt-1">Click any category to expand details</p>
              </div>
            </div>

            {/* Actor Type Totals */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Actor Totals</h3>
              <div className="grid grid-cols-3 gap-4 sm:gap-6">
                <div className="text-center sm:text-left">
                  <p className="text-2xl sm:text-3xl font-bold text-purple-600">{stats.top_people?.length || 0}</p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">People</p>
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-2xl sm:text-3xl font-bold text-amber-600">{stats.top_chapters?.length || 0}</p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">Chapters</p>
                </div>
                <div className="text-center sm:text-left">
                  <p className="text-2xl sm:text-3xl font-bold text-blue-600">{stats.top_organizations?.length || 0}</p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">Organizations</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Actor Stats */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 px-1">Actors</h3>
                {stats.top_people && stats.top_people.length > 0 && (
                  <StatCategory title="People" items={stats.top_people} color="purple" defaultExpanded={true} />
                )}
                {stats.top_chapters && stats.top_chapters.length > 0 && (
                  <StatCategory title="Chapters" items={stats.top_chapters} color="amber" />
                )}
                {stats.top_organizations && stats.top_organizations.length > 0 && (
                  <StatCategory title="Organizations" items={stats.top_organizations} color="blue" />
                )}
              </div>

              {/* Geographic Stats */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 px-1">Geography</h3>
                {stats.cities && stats.cities.length > 0 && (
                  <StatCategory title="Cities" items={stats.cities} color="emerald" defaultExpanded={true} />
                )}
                {stats.states && stats.states.length > 0 && (
                  <StatCategory title="States" items={stats.states} color="cyan" />
                )}
              </div>

              {/* Institutions */}
              {(stats.universities?.length || stats.churches?.length) && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 px-1">Institutions</h3>
                  {stats.universities && stats.universities.length > 0 && (
                    <StatCategory title="Universities" items={stats.universities} color="blue" />
                  )}
                  {stats.churches && stats.churches.length > 0 && (
                    <StatCategory title="Churches" items={stats.churches} color="purple" />
                  )}
                </div>
              )}

              {/* Categories */}
              {stats.categories && stats.categories.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 px-1">Categories</h3>
                  <StatCategory title="All Categories" items={stats.categories} color="rose" />
                </div>
              )}

              {/* Lobbying Topics */}
              {stats.lobbying_topics && stats.lobbying_topics.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 px-1">Lobbying Topics</h3>
                  <StatCategory title="Lobbying Topics" items={stats.lobbying_topics} color="cyan" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* SOCIAL TAB */}
        {/* ================================================================== */}
        {activeSection === 'social' && (
          <div className="space-y-6 sm:space-y-8">
            {/* Social Insights */}
            {report.social_insights && (
              <section className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-3 mb-4 sm:mb-6">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900">Social Media Insights</h2>
                  <span className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 text-xs font-semibold">BETA</span>
                </div>
                <div className="prose prose-sm sm:prose-base prose-gray max-w-none prose-headings:font-bold prose-headings:text-gray-900 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-3 prose-p:text-gray-700 prose-p:leading-relaxed prose-ul:my-2 prose-li:my-0.5 prose-strong:text-gray-900">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {report.social_insights}
                  </ReactMarkdown>
                </div>
              </section>
            )}

            {/* Featured Posts */}
            {report.social_posts && report.social_posts.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-gray-900 mb-4">Featured Posts ({report.social_posts.length})</h3>
                <div className="space-y-4">
                  {report.social_posts.map((post) => (
                    <SocialPostCard key={post.id} post={post} />
                  ))}
                </div>
              </section>
            )}

            {!report.social_insights && (!report.social_posts || report.social_posts.length === 0) && (
              <div className="bg-gray-100 rounded-2xl p-8 sm:p-12 text-center">
                <p className="text-gray-500">No social media data available for this report.</p>
              </div>
            )}
          </div>
        )}

        {/* ================================================================== */}
        {/* SOCIAL FEED TAB */}
        {/* ================================================================== */}
        {activeSection === 'feed' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Social Feed</h2>
              <p className="text-sm text-gray-500 mt-1">Browse social media posts from people involved in this report</p>
            </div>

            {/* Person selector */}
            {stats.top_people && stats.top_people.length > 0 ? (
              <>
                <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Select people to view their posts</h3>
                  <div className="flex flex-wrap gap-2">
                    {stats.top_people.map((person) => {
                      const isSelected = selectedPeople.includes(person.name);
                      return (
                        <button
                          key={person.name}
                          onClick={() => {
                            setSelectedPeople(prev =>
                              isSelected
                                ? prev.filter(n => n !== person.name)
                                : [...prev, person.name]
                            );
                          }}
                          className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {person.name}
                          <span className={`ml-1.5 ${isSelected ? 'text-blue-200' : 'text-gray-400'}`}>
                            ({person.count})
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedPeople.length > 0 && (
                    <button
                      onClick={() => setSelectedPeople([])}
                      className="mt-4 text-sm text-gray-500 hover:text-gray-700"
                    >
                      Clear selection ({selectedPeople.length} selected)
                    </button>
                  )}
                </div>

                {/* Posts display area */}
                {selectedPeople.length > 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
                    <p className="text-sm text-gray-600 mb-4">
                      Showing posts from: <span className="font-semibold text-gray-900">{selectedPeople.join(', ')}</span>
                    </p>
                    <ActorPostsList
                      actorNames={selectedPeople}
                      startDate={report.report_start_date}
                      endDate={report.report_end_date}
                    />
                  </div>
                ) : (
                  <div className="bg-gray-100 rounded-2xl p-8 sm:p-12 text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <p className="text-gray-500">Select people above to browse their social media posts</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-gray-100 rounded-2xl p-8 sm:p-12 text-center">
                <p className="text-gray-500">No people data available for this report.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 sm:mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400">
            <p>Report generated {new Date(report.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <p className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[8px] font-bold">G</span>
              Powered by Gemini AI
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};
