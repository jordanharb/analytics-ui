// Debug script to check raw database response
import { supabaseClient } from './api/supabaseClient';

async function debugDatabaseCoordinates() {
  console.log('Checking raw database coordinates...');
  
  try {
    // Call the RPC directly
    const { data, error } = await supabaseClient
      .rpc('get_map_points', { p_filters: {} });
    
    if (error) {
      console.error('Database error:', error);
      return;
    }
    
    console.log('Raw database response:', data);
    
    // Analyze the data
    const totalPoints = data.map_points.length;
    const nullCoords = data.map_points.filter((p: any) => p.lat === null || p.lon === null);
    const validCoords = data.map_points.filter((p: any) => p.lat !== null && p.lon !== null);
    
    console.log(`Total points: ${totalPoints}`);
    console.log(`Points with null coordinates: ${nullCoords.length}`);
    console.log(`Points with valid coordinates: ${validCoords.length}`);
    
    // Show some examples of null coordinate cities
    if (nullCoords.length > 0) {
      console.log('Cities with null coordinates:', nullCoords.slice(0, 10).map((p: any) => ({
        city: p.city,
        state: p.state,
        count: p.count,
        lat: p.lat,
        lon: p.lon
      })));
    }
    
    // Show some valid coordinate examples
    if (validCoords.length > 0) {
      console.log('Cities with valid coordinates:', validCoords.slice(0, 5).map((p: any) => ({
        city: p.city,
        state: p.state,
        count: p.count,
        lat: p.lat,
        lon: p.lon
      })));
    }
    
    // Let's also check a specific city that shows null
    const miami = data.map_points.find((p: any) => p.city === 'Miami' && p.state === 'FL');
    if (miami) {
      console.log('Miami data from database:', miami);
    }
    
    // Check raw SQL query for coordinates
    const { data: rawQuery, error: queryError } = await supabaseClient
      .rpc('get_map_points', { 
        p_filters: {
          period: 'last_7_days'
        } 
      });
      
    if (!queryError && rawQuery) {
      const miamiInPeriod = rawQuery.map_points.find((p: any) => p.city === 'Miami' && p.state === 'FL');
      console.log('Miami in last_7_days period:', miamiInPeriod);
    }
    
  } catch (err) {
    console.error('Error querying database:', err);
  }
}

// Check if location coordinates exist in v2_events
async function checkLocationsTable() {
  console.log('\nChecking location coordinates in v2_events...');
  
  try {
    const { data, error } = await supabaseClient
      .from('v2_events')
      .select('city, state, latitude, longitude')
      .in('city', ['Miami', 'San Diego', 'Sacramento', 'San Antonio', 'Portland'])
      .not('latitude', 'is', null)
      .limit(10);
    
    if (error) {
      console.error('Error querying v2_events:', error);
      return;
    }
    
    console.log('Sample cities with coordinates from v2_events:', data);
  } catch (err) {
    console.error('Error:', err);
  }
}

// Run both checks
async function runAllChecks() {
  await debugDatabaseCoordinates();
  await checkLocationsTable();
}

// Add to window for console testing
(window as any).debugDatabaseCoordinates = debugDatabaseCoordinates;
(window as any).checkLocationsTable = checkLocationsTable;
(window as any).runAllChecks = runAllChecks;

// Run immediately
runAllChecks();

export { debugDatabaseCoordinates, checkLocationsTable, runAllChecks };