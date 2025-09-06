// Debug script to test the get_map_points API directly
import { analyticsClient } from './api/analyticsClient';

async function debugMapPoints() {
  console.log('Testing get_map_points API...');
  
  // Test with empty filters first
  const emptyFilters = {};
  console.log('Testing with empty filters:', emptyFilters);
  
  try {
    const response = await analyticsClient.getMapPoints(emptyFilters);
    console.log('API Response:', response);
    console.log('Total events:', response.total_events);
    console.log('Number of map points:', response.map_points.length);
    
    if (response.map_points.length > 0) {
      console.log('Sample points:', response.map_points.slice(0, 5));
    }
    
    // Check the structure of map points
    if (response.map_points.length > 0) {
      const point = response.map_points[0];
      console.log('First point structure:', {
        hasCity: 'city' in point,
        hasState: 'state' in point,
        hasLat: 'lat' in point,
        hasLon: 'lon' in point,
        hasCount: 'count' in point,
        actualKeys: Object.keys(point)
      });
    }
  } catch (error) {
    console.error('Error calling get_map_points:', error);
  }
  
  // Test with a date filter
  const dateFilter = {
    period: 'week' as const
  };
  console.log('\nTesting with date filter:', dateFilter);
  
  try {
    const response = await analyticsClient.getMapPoints(dateFilter);
    console.log('API Response with date filter:', response);
    console.log('Total events:', response.total_events);
    console.log('Number of map points:', response.map_points.length);
  } catch (error) {
    console.error('Error with date filter:', error);
  }
}

// Add to window for console testing
(window as any).debugMapPoints = debugMapPoints;

// Run immediately
debugMapPoints();

export { debugMapPoints };