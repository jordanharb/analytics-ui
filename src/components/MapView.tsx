import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  MAPBOX_STYLE,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  CLUSTER_PAINT,
  UNCLUSTERED_PAINT,
  CLUSTER_COUNT_PAINT,
  getMapBounds,
  pointsToGeoJSON
} from '../lib/mapboxConfig';
import { analyticsClient } from '../api/analyticsClient';
import type { MapPointsResponse, Filters } from '../api/types';

interface MapViewProps {
  filters?: Filters;
}

export const MapView: React.FC<MapViewProps> = ({ filters = {} }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapData, setMapData] = useState<MapPointsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

        // Add cluster layer
        map.current!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: CLUSTER_PAINT
        });

        // Add cluster count layer
        map.current!.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'events',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 12
          },
          paint: CLUSTER_COUNT_PAINT
        });

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
          const features = map.current!.queryRenderedFeatures(e.point, {
            layers: ['clusters']
          });
          const clusterId = features[0].properties?.cluster_id;
          const source = map.current!.getSource('events') as mapboxgl.GeoJSONSource;
          
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err) return;
            
            const coordinates = (features[0].geometry as any).coordinates;
            map.current!.easeTo({
              center: coordinates,
              zoom: zoom
            });
          });
        });

        map.current!.on('click', 'unclustered-point', (e) => {
          const coordinates = (e.features![0].geometry as any).coordinates.slice();
          const properties = e.features![0].properties;
          
          // Create popup
          new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`
              <div class="p-3">
                <h3 class="font-semibold text-lg">${properties?.city}, ${properties?.state}</h3>
                <p class="text-sm text-gray-600">${properties?.count} events</p>
              </div>
            `)
            .addTo(map.current!);
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

  // Load map data when filters change
  useEffect(() => {
    loadMapData();
  }, [filters]);

  const loadMapData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await analyticsClient.getMapPoints(filters);
      setMapData(data);
      
      // Update map with new data
      if (map.current && map.current.getSource('events')) {
        const source = map.current.getSource('events') as mapboxgl.GeoJSONSource;
        source.setData(pointsToGeoJSON(data.map_points));
        
        // Fit map to bounds if we have points
        if (data.map_points.length > 0) {
          const bounds = getMapBounds(data.map_points);
          if (bounds) {
            map.current.fitBounds(bounds, { padding: 50 });
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load map data:', err);
      setError(err.message || 'Failed to load map data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full h-full">
      {/* KPI Strip */}
      {mapData && (
        <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4">
          <div className="flex space-x-6">
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
                {new Set(mapData.map_points.map(p => p.state)).size}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 bg-white/75 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-2 text-sm text-gray-600">Loading map data...</p>
          </div>
        </div>
      )}
      
      {/* Error message */}
      {error && (
        <div className="absolute top-4 right-4 z-10 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p className="text-sm">{error}</p>
        </div>
      )}
      
      {/* Map container */}
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
};