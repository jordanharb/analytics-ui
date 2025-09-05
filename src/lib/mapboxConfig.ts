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

// Cluster configuration
export const CLUSTER_PAINT: mapboxgl.CirclePaint = {
  'circle-color': [
    'step',
    ['get', 'point_count'],
    '#51bbd6', // Blue for small clusters
    100,
    '#f1f075', // Yellow for medium clusters
    750,
    '#f28cb1'  // Pink for large clusters
  ],
  'circle-radius': [
    'step',
    ['get', 'point_count'],
    20, // 20px for small clusters
    100,
    30, // 30px for medium clusters
    750,
    40  // 40px for large clusters
  ],
  'circle-opacity': 0.8,
  'circle-stroke-width': 2,
  'circle-stroke-color': '#fff'
};

// Unclustered point configuration
export const UNCLUSTERED_PAINT: mapboxgl.CirclePaint = {
  'circle-color': '#11b4da',
  'circle-radius': [
    'interpolate', 
    ['linear'], 
    ['get', 'count'],
    1, 8,      // 1 event = 8px radius
    10, 12,    // 10 events = 12px radius
    100, 20,   // 100 events = 20px radius
    1000, 30   // 1000 events = 30px radius
  ],
  'circle-stroke-width': 2,
  'circle-stroke-color': '#fff',
  'circle-opacity': 0.9
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