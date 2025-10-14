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
  pointsToGeoJSON
} from '../../lib/mapboxConfig';
import { analyticsClient } from '../../api/analyticsClient';
import { useFiltersStore } from '../../state/filtersStore';
import { FilterPanel } from '../../components/FilterPanel/FilterPanel';
import { SidePanel } from '../../components/SidePanel/SidePanel';
import { SearchBar } from '../../components/SearchBar/SearchBar';
import type { MapPointsResponse } from '../../api/types';

// Valid US state codes (50 states + DC)
const VALID_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC' // Include DC as it's often treated as a state
]);

export const MapView: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapData, setMapData] = useState<MapPointsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<{ city: string; state: string } | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<Array<{ city: string; state: string }> | null>(null);
  const [showFilters, setShowFilters] = useState(true); // Start with filters visible
  const [showVirtualEvents, setShowVirtualEvents] = useState(false);
  const [virtualEventsCount, setVirtualEventsCount] = useState(0);
  const [showStatsModal, setShowStatsModal] = useState(false);

  const { filters, networkExpanded, expandedActorIds, setExpandedActorIds } = useFiltersStore();
  
  // Trigger map resize when filter panel toggles
  useEffect(() => {
    if (map.current) {
      // Wait for CSS transition to complete
      setTimeout(() => {
        map.current?.resize();
      }, 350);
    }
  }, [showFilters]);

  // Load map data function (defined before useEffects)
  const loadMapData = async (retryCount = 0) => {
    // Prevent infinite retries
    if (retryCount > 10) {
      console.error('Max retries reached, stopping');
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Apply network expansion if enabled
      let effectiveFilters = { ...filters };
      
      if (networkExpanded && filters.actor_ids && filters.actor_ids.length > 0) {
        try {
          console.log('Expanding network for actors:', filters.actor_ids);
          const expanded = await analyticsClient.getNetworkActorIds(filters.actor_ids);
          console.log('Expanded to include:', expanded);
          setExpandedActorIds(expanded);
          // ✅ PRESERVE period/date_range during network expansion
          effectiveFilters = { 
            ...filters, 
            actor_ids: expanded
            // Keep period and date_range from original filters
          };
        } catch (err) {
          console.error('Failed to expand network:', err);
          // Fall back to original filters
        }
      } else if (!networkExpanded && expandedActorIds) {
        // Clear expanded IDs when network expansion is disabled
        setExpandedActorIds(null);
      }
      
      console.log('Loading map data with filters:', effectiveFilters);
      const data = await analyticsClient.getMapPoints(effectiveFilters);
      console.log('Received map data:', data);
      setMapData(data);
      
      // Calculate virtual/non-geocoded events as total_events minus geocoded events
      const geocodedSum = data.map_points.reduce((sum, p) => sum + (p.count || 0), 0);
      const virtualEventCount = Math.max(0, (data.total_events || 0) - geocodedSum);
      setVirtualEventsCount(virtualEventCount);
      
      // Update map with new data
      if (map.current && map.current.isStyleLoaded()) {
        const source = map.current.getSource('events') as mapboxgl.GeoJSONSource;
        if (source) {
          const geoJSON = pointsToGeoJSON(data.map_points);
          console.log('Converting to GeoJSON:', geoJSON);
          source.setData(geoJSON);
          
          // Fit map to bounds if we have valid points
          const validPoints = data.map_points.filter(p => p.lat !== null && p.lon !== null);
          if (validPoints.length > 0) {
            const bounds = getMapBounds(validPoints);
            console.log('Fitting to bounds:', bounds);
            if (bounds) {
              map.current.fitBounds(bounds, { padding: 50 });
            }
          } else {
            console.log('No geocoded points returned from API');
          }
        } else if (retryCount < 10) {
          console.log(`Map source not ready yet, retry ${retryCount + 1}/10...`);
          // Retry after map loads
          setTimeout(() => loadMapData(retryCount + 1), 500);
        }
      } else if (retryCount < 10) {
        console.log(`Map not ready yet, retry ${retryCount + 1}/10...`);
        // Retry after map loads
        setTimeout(() => loadMapData(retryCount + 1), 500);
      }
    } catch (err: any) {
      console.error('Failed to load map data:', err);
      setError(err.message || 'Failed to load map data');
    } finally {
      setLoading(false);
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: MAPBOX_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM
      });

      map.current.on('load', () => {
        console.log('Map loaded successfully');
        
        // Add navigation controls
        map.current!.addControl(new mapboxgl.NavigationControl(), 'top-right');
        
        // Add source for our data
        map.current!.addSource('events', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: []
          },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50
        });

        // Add cluster layer (no text labels - size and color indicate density)
        map.current!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: CLUSTER_PAINT
        });
        console.log('Added clusters layer');

        // Add unclustered point layer
        map.current!.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          paint: UNCLUSTERED_PAINT
        });

        // Click handlers
        map.current!.on('click', 'clusters', (e) => {
          console.log('Cluster clicked!', e);
          const features = map.current!.queryRenderedFeatures(e.point, {
            layers: ['clusters']
          });
          console.log('Cluster features:', features);
          
          if (!features || features.length === 0) {
            console.log('No cluster features found');
            return;
          }
          
          const clusterId = features[0].properties?.cluster_id;
          console.log('Cluster ID:', clusterId);
          const source = map.current!.getSource('events') as mapboxgl.GeoJSONSource;
          
          // Recursively get all leaf cities from a cluster
          const getAllCitiesFromCluster = (clusterId: number, callback: (cities: Array<{city: string, state: string}>) => void) => {
            source.getClusterLeaves(clusterId, 100, 0, (err, leaves) => {
              console.log('Getting cluster leaves, err:', err, 'leaves:', leaves);
              
              if (err || !leaves) {
                // Fallback: just zoom in
                source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                  if (err) return;
                  
                  const coordinates = (features[0].geometry as any).coordinates;
                  map.current!.easeTo({
                    center: coordinates,
                    zoom: zoom ?? 12
                  });
                });
                return;
              }
              
              // The leaves are returned as an object with features array
              const leafFeatures = (leaves as any).features || leaves;
              console.log('Leaf features:', leafFeatures);
              
              // Extract cities from leaves - these should all be actual points, not sub-clusters
              const cities = (Array.isArray(leafFeatures) ? leafFeatures : []).map((f: any) => ({
                city: f.properties?.city || '',
                state: f.properties?.state
              })).filter((c: any) => c.state);
              
              console.log('Extracted cities from cluster leaves:', cities);
              callback(cities);
            });
          };
          
          // Get all cities from the cluster
          getAllCitiesFromCluster(clusterId, (cities) => {
            if (cities.length > 0) {
              setSelectedCluster(cities);
              setSelectedCity(null);
            } else {
              // If no cities extracted, zoom in
              source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                
                const coordinates = (features[0].geometry as any).coordinates;
                map.current!.easeTo({
                  center: coordinates,
                  zoom: (zoom ?? 11) + 1
                });
              });
            }
          });
        });

        map.current!.on('click', 'unclustered-point', (e) => {
          const properties = e.features![0].properties;
          console.log('Unclustered point clicked!', properties);
          
          // Handle clicks on points, including statewide events (no city)
          if (properties?.state) {
            // Keep the original city value (could be null/empty for statewide)
            const city = properties.city || '';
            console.log(`Selected: ${city || 'Statewide'}, ${properties.state}`);
            
            setSelectedCity({
              city: city,
              state: properties.state
            });
            setSelectedCluster(null);
          } else {
            console.warn('Point clicked but missing state property:', properties);
          }
        });

        // Change cursor on hover
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
        
        // Load initial data after map is ready
        loadMapData();
      });

    } catch (err) {
      console.error('Failed to initialize map:', err);
      setError('Failed to initialize map');
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Load map data when filters or network expansion change
  useEffect(() => {
    if (map.current) {
      console.log('Filters/network changed, reloading map data');
      loadMapData();
    }
  }, [filters, networkExpanded]);

  return (
    <div className="h-full flex flex-row overflow-hidden">
      {/* Filter Panel - Desktop: side panel, Mobile: overlay */}
      {showFilters && (
        <FilterPanel
          className="w-full md:w-80 h-full flex-shrink-0 md:relative fixed top-16 bottom-0 left-0 z-40 md:z-10 md:top-0 md:bottom-auto overflow-hidden"
          onClose={() => setShowFilters(false)}
        />
      )}

      {/* Filter Panel Backdrop (Mobile) */}
      {showFilters && (
        <div
          className="fixed inset-0 top-16 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setShowFilters(false)}
        />
      )}

      {/* Map Container - Always takes remaining space */}
      <div className="flex-1 relative min-w-0 h-full">
        
        {/* Mobile: Compact Search + Filter Row */}
        <div className="absolute top-4 left-4 right-4 z-10 md:hidden">
          <div className="flex space-x-2">
            {/* Filter Toggle Button */}
            {!showFilters && (
              <button
                onClick={() => setShowFilters(true)}
                className="bg-white rounded-lg shadow-lg p-2 hover:bg-gray-50 touch-manipulation flex-shrink-0"
                style={{ minHeight: '40px', minWidth: '40px' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            )}
            
            {/* Compact Search Bar */}
            <div className="flex-1">
              <SearchBar 
                placeholder="Search events..."
                className="bg-white rounded-lg shadow-lg text-sm h-10"
              />
            </div>
          </div>
        </div>

        {/* Desktop: Original Layout */}
        <div className="hidden md:block">
          {/* Toggle Filters Button (when hidden) */}
          {!showFilters && (
            <button
              onClick={() => setShowFilters(true)}
              className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-3 hover:bg-gray-50 touch-manipulation"
              style={{ minHeight: '44px', minWidth: '44px' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
          )}
          
          {/* Search Bar */}
          <div className="absolute top-4 left-16 md:left-20 right-4 z-10 max-w-md">
            <SearchBar 
              placeholder="Search events by topic, description, or context..."
              className="bg-white rounded-lg shadow-lg text-sm"
            />
          </div>
        </div>
        
        {/* Stats Bar with Virtual Events - Mobile Expandable */}
        {mapData && (
          <div className="absolute top-16 md:top-20 left-4 md:left-20 right-4 md:right-auto z-10">
            {/* Mobile: Compact Stats + Virtual Button */}
            <div className="md:hidden bg-white rounded-lg shadow-lg px-3 py-2">
              <button
                onClick={() => setShowStatsModal(true)}
                className="w-full flex items-center justify-between text-xs touch-manipulation"
                style={{ minHeight: '32px' }}
              >
                <div className="flex items-center space-x-3">
                  <div className="flex items-center">
                    <span className="text-blue-600">📊</span>
                    <span className="ml-1 font-semibold">{mapData.total_events.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-green-600">🏙️</span>
                    <span className="ml-1 font-semibold">{mapData.map_points.length}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-purple-600">📍</span>
                    <span className="ml-1 font-semibold">
                      {new Set(mapData.map_points
                        .map(p => p.state)
                        .filter(state => VALID_STATE_CODES.has(state))
                      ).size}
                    </span>
                  </div>
                </div>
                
                {/* Virtual Events Button + Expand Indicator */}
                <div className="flex items-center space-x-2">
                  {virtualEventsCount > 0 && (
                    <div 
                      className="flex items-center bg-amber-100 text-amber-700 px-2 py-1 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowVirtualEvents(true);
                        setSelectedCity(null);
                        setSelectedCluster(null);
                      }}
                    >
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs font-bold">{virtualEventsCount}</span>
                    </div>
                  )}
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
            </div>
            
            {/* Desktop: Full Stats */}
            <div className="hidden md:block bg-white rounded-lg shadow-lg p-4">
              <div className="flex space-x-6 text-base">
                <div>
                  <div className="text-sm text-gray-500">Total Events</div>
                  <div className="text-2xl font-bold">{mapData.total_events.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Cities</div>
                  <div className="text-2xl font-bold">{mapData.map_points.length}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">States</div>
                  <div className="text-2xl font-bold">
                    {new Set(mapData.map_points
                      .map(p => p.state)
                      .filter(state => VALID_STATE_CODES.has(state))
                    ).size}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full-Screen Stats Modal (Mobile Only) */}
        {showStatsModal && (
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-black bg-opacity-50"
              onClick={() => setShowStatsModal(false)}
            />
            
            {/* Modal Content */}
            <div className="absolute inset-x-4 top-20 bottom-20 bg-white rounded-lg shadow-xl overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Event Statistics</h2>
                <button
                  onClick={() => setShowStatsModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg touch-manipulation"
                  style={{ minHeight: '44px', minWidth: '44px' }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Stats Content */}
              <div className="p-6 space-y-6">
                {/* Main Stats */}
                <div className="grid grid-cols-1 gap-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="flex items-center">
                      <span className="text-2xl mr-3">📊</span>
                      <div>
                        <div className="text-sm text-blue-600 font-medium">Total Events</div>
                        <div className="text-3xl font-bold text-blue-800">{mapData?.total_events.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="flex items-center">
                      <span className="text-2xl mr-3">🏙️</span>
                      <div>
                        <div className="text-sm text-green-600 font-medium">Cities</div>
                        <div className="text-3xl font-bold text-green-800">{mapData?.map_points.length}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-purple-50 rounded-lg p-4">
                    <div className="flex items-center">
                      <span className="text-2xl mr-3">📍</span>
                      <div>
                        <div className="text-sm text-purple-600 font-medium">States</div>
                        <div className="text-3xl font-bold text-purple-800">
                          {mapData && new Set(mapData.map_points
                            .map(p => p.state)
                            .filter(state => VALID_STATE_CODES.has(state))
                          ).size}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Virtual Events Section */}
                {virtualEventsCount > 0 && (
                  <div className="pt-4 border-t border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Additional Events</h3>
                    <button
                      onClick={() => {
                        setShowVirtualEvents(true);
                        setSelectedCity(null);
                        setSelectedCluster(null);
                        setShowStatsModal(false);
                      }}
                      className="w-full bg-amber-50 border border-amber-300 text-amber-700 p-4 rounded-lg hover:bg-amber-100 transition-colors touch-manipulation"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <div className="text-left">
                            <div className="font-medium">Virtual/Non-geocoded Events</div>
                            <div className="text-sm text-amber-600">Events without location data</div>
                          </div>
                        </div>
                        <span className="bg-amber-200 text-amber-800 px-3 py-1 rounded-full text-sm font-bold">
                          {virtualEventsCount}
                        </span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Desktop Virtual/Non-geocoded Events Button */}
        {virtualEventsCount > 0 && (
          <div className="absolute top-4 right-4 z-10 hidden md:block">
            <button
              onClick={() => {
                setShowVirtualEvents(true);
                setSelectedCity(null);
                setSelectedCluster(null);
              }}
              className="bg-amber-50 border border-amber-300 text-amber-700 rounded-lg shadow-lg hover:bg-amber-100 transition-colors flex items-center space-x-2 touch-manipulation px-4 py-2"
              style={{ minHeight: '44px' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="font-medium">Virtual/Non-geocoded</span>
              <span className="bg-amber-200 text-amber-800 px-2 py-1 rounded-full text-xs font-bold">
                {virtualEventsCount}
              </span>
            </button>
          </div>
        )}
        
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-20 bg-white/75 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-sm text-gray-600">Loading map data...</p>
            </div>
          </div>
        )}
        
        {/* Error message */}
        {error && (
          <div className="absolute top-4 right-4 z-10 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg max-w-sm">
            <p className="text-sm">{error}</p>
          </div>
        )}
        
        {/* Map */}
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        
        {/* Side Panel */}
        <SidePanel
          city={selectedCity}
          cluster={selectedCluster}
          showVirtual={showVirtualEvents}
          filters={filters}
          onClose={() => {
            setSelectedCity(null);
            setSelectedCluster(null);
            setShowVirtualEvents(false);
          }}
        />
      </div>
    </div>
  );
};