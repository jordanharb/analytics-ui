import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  MAPBOX_STYLE,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  CLUSTER_PAINT,
  UNCLUSTERED_PAINT,
  getMapBounds,
  pointsToGeoJSON,
} from '../../lib/mapboxConfig';
import { analyticsClient } from '../../api/analyticsClient';
import { useFiltersStore } from '../../state/filtersStore';
import { FilterPanel } from '../../components/FilterPanel/FilterPanel';
import { SidePanel } from '../../components/SidePanel/SidePanel';
import { SearchBar } from '../../components/SearchBar/SearchBar';
import type { MapPointsResponse } from '../../api/types';

// fieldnotes palette: page #f6f1e6, surface #fdfaf2, ink #1a1a1a, muted #6b6b6b, accent #c2410c

// Valid US state codes (50 states + DC)
const VALID_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

export const MapView: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapData, setMapData] = useState<MapPointsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<{ city: string; state: string } | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Array<{ city: string; state: string }> | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [showUnmapped, setShowUnmapped] = useState(false);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [showStatsModal, setShowStatsModal] = useState(false);

  const { filters, networkExpanded, expandedActorIds, setExpandedActorIds } = useFiltersStore();

  // Resize on filter panel toggle
  useEffect(() => {
    if (map.current) setTimeout(() => map.current?.resize(), 350);
  }, [showFilters]);

  const loadingRef = useRef(false);

  const loadMapData = async (retryCount = 0) => {
    if (loadingRef.current) return;
    if (retryCount > 3) {
      setLoading(false);
      loadingRef.current = false;
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      let effectiveFilters = { ...filters };

      if (networkExpanded && filters.actor_ids && filters.actor_ids.length > 0) {
        try {
          const expanded = await analyticsClient.getNetworkActorIds(filters.actor_ids);
          setExpandedActorIds(expanded);
          effectiveFilters = { ...filters, actor_ids: expanded };
        } catch (err) {
          console.error('Failed to expand network:', err);
        }
      } else if (!networkExpanded && expandedActorIds) {
        setExpandedActorIds(null);
      }

      const data = await analyticsClient.getMapPoints(effectiveFilters);
      setMapData(data);

      // Unmapped = total - geocoded
      const geocodedSum = data.map_points.reduce((sum, p) => sum + (p.count || 0), 0);
      const unmapped = Math.max(0, (data.total_events || 0) - geocodedSum);
      setUnmappedCount(unmapped);

      if (map.current && map.current.isStyleLoaded()) {
        const source = map.current.getSource('events') as mapboxgl.GeoJSONSource;
        if (source) {
          const geoJSON = pointsToGeoJSON(data.map_points);
          source.setData(geoJSON);

          const validPoints = data.map_points.filter((p) => p.lat !== null && p.lon !== null);
          if (validPoints.length > 0) {
            const bounds = getMapBounds(validPoints);
            if (bounds) map.current.fitBounds(bounds, { padding: 50 });
          }
        } else if (retryCount < 3) {
          loadingRef.current = false;
          setTimeout(() => loadMapData(retryCount + 1), 1000);
          return;
        }
      } else if (retryCount < 3) {
        loadingRef.current = false;
        setTimeout(() => loadMapData(retryCount + 1), 1000);
        return;
      }
    } catch (err: any) {
      console.error('Failed to load map data:', err);
      setError(err.message || 'failed to load map data');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: MAPBOX_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });

      map.current.on('load', () => {
        map.current!.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.current!.addSource('events', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        });

        map.current!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: CLUSTER_PAINT,
        });

        map.current!.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          paint: UNCLUSTERED_PAINT,
        });

        // Cluster click → drill down to cities or zoom in
        map.current!.on('click', 'clusters', (e) => {
          const features = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] });
          if (!features || features.length === 0) return;

          const clusterId = features[0].properties?.cluster_id;
          const source = map.current!.getSource('events') as mapboxgl.GeoJSONSource;

          const getAllCitiesFromCluster = (
            clusterId: number,
            callback: (cities: Array<{ city: string; state: string }>) => void,
          ) => {
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
              const cities = (Array.isArray(leafFeatures) ? leafFeatures : [])
                .map((f: any) => ({ city: f.properties?.city || '', state: f.properties?.state }))
                .filter((c: any) => c.state);

              callback(cities);
            });
          };

          getAllCitiesFromCluster(clusterId, (cities) => {
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
            const city = properties.city || '';
            setSelectedCity({ city, state: properties.state });
            setSelectedCluster(null);
          }
        });

        map.current!.on('mouseenter', 'clusters', () => {
          map.current!.getCanvas().style.cursor = 'pointer';
        });
        map.current!.on('mouseleave', 'clusters', () => {
          map.current!.getCanvas().style.cursor = '';
        });
        map.current!.on('mouseenter', 'unclustered-point', () => {
          map.current!.getCanvas().style.cursor = 'pointer';
        });
        map.current!.on('mouseleave', 'unclustered-point', () => {
          map.current!.getCanvas().style.cursor = '';
        });

        loadMapData();
      });
    } catch (err) {
      console.error('Failed to initialize map:', err);
      setError('failed to initialize map');
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Reload on filter / network change
  useEffect(() => {
    if (map.current) loadMapData();
  }, [filters, networkExpanded]);

  const stateCount =
    mapData &&
    new Set(mapData.map_points.map((p) => p.state).filter((s) => VALID_STATE_CODES.has(s))).size;

  return (
    <div className="h-full flex bg-[#f6f1e6]">
      {/* Filter panel (desktop side, mobile overlay) */}
      {showFilters && (
        <FilterPanel
          className="w-full md:w-80 h-full flex-shrink-0 md:relative fixed top-16 bottom-0 left-0 z-40 md:z-10 md:top-0 md:bottom-auto"
          onClose={() => setShowFilters(false)}
        />
      )}

      {showFilters && (
        <div
          className="fixed inset-0 top-16 bg-black/40 z-30 md:hidden"
          onClick={() => setShowFilters(false)}
        />
      )}

      {/* Map column */}
      <div className="flex-1 relative min-w-0 p-3 md:p-4">
        <div className="absolute inset-3 md:inset-4 rounded-lg border border-black/[0.1] overflow-hidden bg-[#fdfaf2]">
          {/* Top row — search only. Mapbox NavigationControl lives at top-right (~46px wide), so we leave room for it. */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2" style={{ right: 64 }}>
            {!showFilters && (
              <button
                onClick={() => setShowFilters(true)}
                className="bg-[#fdfaf2] border border-black/[0.12] hover:bg-[#ede5d2] transition-colors flex items-center justify-center text-[#2a2a2a] flex-shrink-0"
                style={{ width: 36, height: 36, borderRadius: 6 }}
                title="show filters"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            )}

            <div className="flex-1 min-w-0">
              <SearchBar
                placeholder="search events by topic, description, or context…"
                className="bg-[#fdfaf2] border border-black/[0.12] text-sm h-9"
              />
            </div>
          </div>

          {/* Bottom-left — combined stats + unmapped pill (desktop) */}
          {mapData && (
            <div className="absolute bottom-4 left-4 z-10 hidden md:flex items-stretch gap-2">
              <div
                className="bg-[#fdfaf2] border border-black/[0.15] flex items-center gap-4 px-4 py-2.5 text-[13px] text-[#1a1a1a]"
                style={{
                  borderRadius: 8,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}
              >
                <Stat label="events" value={mapData.total_events.toLocaleString()} />
                <span className="w-px self-stretch bg-black/[0.1]" aria-hidden />
                <Stat label="cities" value={mapData.map_points.length.toLocaleString()} />
                <span className="w-px self-stretch bg-black/[0.1]" aria-hidden />
                <Stat label="states" value={String(stateCount ?? 0)} />
              </div>

              {unmappedCount > 0 && (
                <button
                  onClick={() => {
                    setShowUnmapped(true);
                    setSelectedCity(null);
                    setSelectedCluster(null);
                  }}
                  className="bg-[#fdf2ed] border border-[rgba(194,65,12,0.3)] hover:bg-[#fce5d8] transition-colors flex items-center gap-2 px-4 py-2.5"
                  style={{
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                  title="events without geocoded location"
                >
                  <span
                    aria-hidden
                    style={{ width: 8, height: 8, borderRadius: '50%', background: '#c2410c', display: 'inline-block' }}
                  />
                  <span className="text-[13px] font-medium text-[#9a330a] tabular-nums">
                    {unmappedCount.toLocaleString()}
                  </span>
                  <span className="text-[13px] text-[#9a330a]">unmapped</span>
                </button>
              )}
            </div>
          )}

          {/* Mobile compact stats button (bottom) */}
          {mapData && (
            <div className="absolute bottom-3 left-3 right-3 z-10 md:hidden">
              <button
                onClick={() => setShowStatsModal(true)}
                className="w-full bg-[#fdfaf2] border border-black/[0.15] rounded-md px-3 py-2.5 text-[13px] text-[#1a1a1a] flex items-center justify-between"
                style={{
                  minHeight: 40,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}
              >
                <div className="flex items-center gap-3 tabular-nums">
                  <span>
                    <span className="text-[#6b6b6b]">events </span>
                    <span className="font-medium">{mapData.total_events.toLocaleString()}</span>
                  </span>
                  <span className="text-[#9a9a9a]">·</span>
                  <span>
                    <span className="text-[#6b6b6b]">cities </span>
                    <span className="font-medium">{mapData.map_points.length.toLocaleString()}</span>
                  </span>
                  <span className="text-[#9a9a9a]">·</span>
                  <span>
                    <span className="text-[#6b6b6b]">states </span>
                    <span className="font-medium">{stateCount ?? 0}</span>
                  </span>
                </div>
                {unmappedCount > 0 && (
                  <span
                    className="ml-2 flex items-center gap-1 text-[12px] text-[#9a330a] flex-shrink-0"
                    style={{
                      background: '#fdf2ed',
                      border: '0.5px solid rgba(194,65,12,0.3)',
                      padding: '2px 8px',
                      borderRadius: 10,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c2410c', display: 'inline-block' }} />
                    {unmappedCount.toLocaleString()}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Mobile stats modal */}
          {showStatsModal && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setShowStatsModal(false)}
              />
              <div className="absolute inset-x-4 top-20 bottom-20 bg-[#fdfaf2] border border-black/[0.12] rounded-lg overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.08]">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">map</div>
                    <h2 className="text-base font-medium text-[#1a1a1a] mt-0.5">at a glance</h2>
                  </div>
                  <button
                    onClick={() => setShowStatsModal(false)}
                    className="p-2 hover:bg-[#ede5d2] rounded-md text-[#6b6b6b]"
                    style={{ minHeight: 40, minWidth: 40 }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-5 space-y-3">
                  <StatRow label="events" value={mapData?.total_events.toLocaleString() ?? '—'} />
                  <StatRow label="cities" value={mapData?.map_points.length.toLocaleString() ?? '—'} />
                  <StatRow label="states" value={String(stateCount ?? 0)} />

                  {unmappedCount > 0 && (
                    <button
                      onClick={() => {
                        setShowUnmapped(true);
                        setSelectedCity(null);
                        setSelectedCluster(null);
                        setShowStatsModal(false);
                      }}
                      className="w-full mt-4 text-left bg-[#fdf2ed] border border-[rgba(194,65,12,0.25)] rounded-md p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.4px] text-[#9a330a]">unmapped</div>
                          <div className="text-sm text-[#9a330a] mt-0.5">events without geocoded location</div>
                        </div>
                        <span className="text-[22px] font-medium text-[#9a330a] tabular-nums">
                          {unmappedCount.toLocaleString()}
                        </span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 z-20 bg-[#fdfaf2]/70 flex items-center justify-center">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-[#c2410c] border-t-transparent"></div>
                <p className="mt-2 text-xs text-[#6b6b6b]">loading map…</p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="absolute z-10 bg-[#fdf2ed] border border-[rgba(194,65,12,0.25)] text-[#9a330a] px-3 py-2 rounded-md max-w-xs text-xs"
              style={{ top: 56, right: 12 }}
            >
              {error}
            </div>
          )}

          {/* Map canvas */}
          <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        </div>

        {/* Side panel */}
        <SidePanel
          city={selectedCity}
          cluster={selectedCluster}
          showVirtual={showUnmapped}
          filters={filters}
          onClose={() => {
            setSelectedCity(null);
            setSelectedCluster(null);
            setShowUnmapped(false);
          }}
        />
      </div>
    </div>
  );
};

// Inline stat shown in the bottom-left desktop pill
const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-[11px] uppercase tracking-[0.4px] text-[#6b6b6b]">{label}</span>
    <span className="text-[14px] font-medium text-[#1a1a1a] tabular-nums">{value}</span>
  </span>
);

// Used inside the mobile stats modal
const StatRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between bg-[#f6f1e6] border border-black/[0.08] rounded-md px-4 py-3">
    <span className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">{label}</span>
    <span className="text-[20px] font-medium text-[#1a1a1a] tabular-nums">{value}</span>
  </div>
);
