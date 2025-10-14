import mapboxgl from 'mapbox-gl';

// Set token from env
// Note: Using a public token instead of secret token for client-side use
// The secret token (sk.*) should only be used server-side
// For now, disabling the map until a proper public token is provided
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/light-v11';

// Default map center (USA)
export const DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283];
export const DEFAULT_ZOOM = 4;

// Cluster configuration - Size and color scale proportionally with event count
export const CLUSTER_PAINT: mapboxgl.CirclePaint = {
  // Neutral gray gradient that darkens with more events
  'circle-color': [
    'interpolate',
    ['linear'],
    ['get', 'point_count'],
    1,    '#D1D5DB',  // Very light gray for minimal clusters
    50,   '#9CA3AF',  // Light gray
    200,  '#6B7280',  // Medium gray
    500,  '#4B5563',  // Dark gray
    1000, '#374151'   // Darker gray for massive clusters
  ],
  // Exponential size scaling with min/max limits
  'circle-radius': [
    'interpolate',
    ['exponential', 1.5], // Exponential curve for smoother visual hierarchy
    ['get', 'point_count'],
    1,    8,   // Minimum size: 8px
    10,   12,  // Small clusters
    50,   16,  // Medium-small
    200,  22,  // Medium-large
    500,  28,  // Large
    1000, 32   // Maximum size: 32px
  ],
  'circle-opacity': 0.85,
  'circle-stroke-width': 1.5,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-opacity': 0.6
};

// Unclustered point configuration - Matches cluster styling for visual consistency
export const UNCLUSTERED_PAINT: mapboxgl.CirclePaint = {
  // Neutral gray that darkens with more events
  'circle-color': [
    'interpolate',
    ['linear'],
    ['get', 'count'],
    1,   '#D1D5DB',  // Very light gray for single events
    5,   '#9CA3AF',  // Light gray
    20,  '#6B7280',  // Medium gray
    50,  '#4B5563',  // Dark gray
    100, '#374151'   // Darker gray for many events
  ],
  'circle-radius': [
    'interpolate',
    ['exponential', 1.5], // Exponential scaling for visual consistency
    ['get', 'count'],
    1,   6,   // Minimum size: 6px
    5,   10,  // Small
    20,  14,  // Medium
    50,  18,  // Large
    100, 24   // Maximum size: 24px
  ],
  'circle-stroke-width': 1.5,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-opacity': 0.6,
  'circle-opacity': 0.85
};

// Cluster text label
export const CLUSTER_COUNT_PAINT: mapboxgl.SymbolPaint = {
  'text-color': '#ffffff'
};

// Helper to get map bounds from points
export const getMapBounds = (points: Array<{ lat: number; lon: number }>) => {
  // Filter out points with null coordinates
  const validPoints = points.filter(p => p.lat !== null && p.lon !== null);
  
  if (validPoints.length === 0) return undefined;
  
  const bounds = new mapboxgl.LngLatBounds();
  validPoints.forEach(p => bounds.extend([p.lon, p.lat]));
  return bounds;
};

// Convert our data to GeoJSON for Mapbox
export const pointsToGeoJSON = (
  points: Array<{ city: string; state: string; lat: number; lon: number; count: number }>
): GeoJSON.FeatureCollection => {
  // Filter out points with null coordinates
  const validPoints = points.filter(p => p.lat !== null && p.lon !== null);
  
  console.log(`Filtering map points: ${points.length} total, ${validPoints.length} with valid coordinates`);
  
  return {
    type: 'FeatureCollection',
    features: validPoints.map(p => ({
      type: 'Feature',
      properties: {
        city: p.city,
        state: p.state,
        count: p.count
      },
      geometry: {
        type: 'Point',
        coordinates: [p.lon, p.lat]
      }
    }))
  };
};