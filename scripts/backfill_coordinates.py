"""
Enhanced coordinate backfill script that uses location_coordinates table as cache
"""
import sys
import argparse
from pathlib import Path
import time
from datetime import datetime

# Ensure imports work when run from repo root
CURR = Path(__file__).resolve()
SCRIPTS_DIR = CURR.parent
ANALYTICS_UI_DIR = SCRIPTS_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

# Prefer repo root, then web/, then analytics-ui/, then scripts/
for p in [str(REPO_ROOT), str(WEB_DIR), str(ANALYTICS_UI_DIR), str(SCRIPTS_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from scripts.utils.database import get_supabase, fetch_all_rows
from scripts.utils.geocoding import geocode_city_state


def check_coordinates_cache(supabase, city, state):
    """
    Check if coordinates exist in the location_coordinates table.
    Returns (latitude, longitude) tuple or None if not found.
    """
    try:
        location_type = 'city' if city else 'state'
        
        query = supabase.table('location_coordinates')\
            .select('latitude, longitude, confidence_score')\
            .eq('state', state)\
            .eq('location_type', location_type)
        
        if city:
            query = query.eq('city', city)
        else:
            query = query.is_('city', 'null')
        
        result = query.execute()
        
        if result.data and len(result.data) > 0:
            coord = result.data[0]
            return float(coord['latitude']), float(coord['longitude'])
        
        return None
    except Exception as e:
        print(f"   ⚠️  Error checking cache: {e}")
        return None


def save_to_coordinates_cache(supabase, city, state, latitude, longitude, source='google'):
    """
    Save coordinates to the location_coordinates table for future use.
    """
    try:
        location_type = 'city' if city else 'state'
        
        # Try to insert or update using the SQL function
        result = supabase.rpc('upsert_location_coordinates', {
            'city_param': city,
            'state_param': state,
            'latitude_param': latitude,
            'longitude_param': longitude,
            'source_param': source,
            'confidence_param': 0.95 if source == 'google' else 0.80
        }).execute()
        
        return True
    except Exception as e:
        # Fallback to direct insert/update
        try:
            data = {
                'city': city,
                'state': state,
                'location_type': location_type,
                'latitude': latitude,
                'longitude': longitude,
                'geocoding_source': source,
                'confidence_score': 0.95 if source == 'google' else 0.80,
                'last_verified': datetime.now().isoformat()
            }
            
            # Try insert first
            result = supabase.table('location_coordinates').insert(data).execute()
            return True
        except:
            # If insert fails, try update
            try:
                query = supabase.table('location_coordinates')\
                    .update({
                        'latitude': latitude,
                        'longitude': longitude,
                        'geocoding_source': source,
                        'confidence_score': 0.95 if source == 'google' else 0.80,
                        'last_verified': datetime.now().isoformat(),
                        'updated_at': datetime.now().isoformat()
                    })\
                    .eq('state', state)\
                    .eq('location_type', location_type)
                
                if city:
                    query = query.eq('city', city)
                else:
                    query = query.is_('city', 'null')
                
                result = query.execute()
                return True
            except Exception as update_error:
                print(f"   ⚠️  Error saving to cache: {update_error}")
                return False


def reset_coordinates(supabase):
    """
    Reset mode: Clear all event coordinates and optionally clear the cache.
    """
    print("🔄 RESET MODE: Clearing all coordinates...")
    
    try:
        # Count events with coordinates
        count_result = supabase.table('v2_events')\
            .select('id', count='exact')\
            .not_.is_('latitude', 'null')\
            .limit(1)\
            .execute()
        
        events_with_coords = count_result.count or 0
        
        if events_with_coords > 0:
            print(f"📊 Found {events_with_coords} events with coordinates to clear")
            
            # Clear coordinates in batches
            batch_size = 1000
            cleared = 0
            
            while cleared < events_with_coords:
                # Get batch of events with coordinates
                batch_result = supabase.table('v2_events')\
                    .select('id')\
                    .not_.is_('latitude', 'null')\
                    .limit(batch_size)\
                    .execute()
                
                if not batch_result.data:
                    break
                
                # Extract IDs
                ids = [e['id'] for e in batch_result.data]
                
                # Clear coordinates for this batch
                update_result = supabase.table('v2_events')\
                    .update({'latitude': None, 'longitude': None})\
                    .in_('id', ids)\
                    .execute()
                
                batch_cleared = len(update_result.data) if update_result.data else 0
                cleared += batch_cleared
                print(f"   ✅ Cleared {cleared}/{events_with_coords} events")
            
            print(f"✅ Reset complete: cleared coordinates from {cleared} events")
        else:
            print("✅ No events had coordinates to clear")
        
        return True
        
    except Exception as e:
        print(f"❌ Error during reset: {e}")
        return False


def backfill_v2_event_coordinates_enhanced(use_cache=True, reset=False):
    """
    Enhanced backfill that uses location_coordinates table as cache.
    
    Args:
        use_cache: Whether to use cached coordinates (default: True)
        reset: Whether to clear all coordinates first (default: False)
    """
    supabase = get_supabase()
    
    if reset:
        if not reset_coordinates(supabase):
            return False
        print()  # Add blank line after reset
    
    print("🗺️  Starting coordinate backfill for v2_events...")
    
    # First, clean up any 'Unknown' cities and variations (case-insensitive)
    print("🧹 Cleaning up non-geographic and virtual location variations...")
    try:
        # Get all distinct cities to check for variations
        all_cities = supabase.table('v2_events')\
            .select('city')\
            .not_.is_('city', 'null')\
            .neq('city', '')\
            .execute()
        
        unknown_variations = set()
        virtual_variations = set()
        
        for record in all_cities.data:
            city = record.get('city', '')
            if not city:
                continue
                
            city_lower = city.lower()
            
            # Check for 'unknown' in any case, or common typos
            if any(pattern in city_lower for pattern in ['unknown', 'unkown', 'unknwn', 'uknown']):
                unknown_variations.add(city)
            # Check for virtual/national/multi-state locations
            elif any(pattern in city_lower for pattern in [
                'national', 'nationwide', 'usa', 'united states', 
                'multiple', 'various', 'virtual', 'online', 'remote',
                'multi-state', 'multistate', 'multiple states',
                'everywhere', 'anywhere', 'n/a', 'tbd', 'multiple cities'
            ]):
                virtual_variations.add(city)
        
        total_cleaned = 0
        
        if unknown_variations:
            print(f"   Found {len(unknown_variations)} 'Unknown' variations to clean:")
            for city in sorted(unknown_variations):
                # Update to NULL so they become state-level events
                result = supabase.table('v2_events')\
                    .update({'city': None})\
                    .eq('city', city)\
                    .execute()
                count = len(result.data) if result.data else 0
                total_cleaned += count
                print(f"   - '{city}': {count} events → NULL")
        
        if virtual_variations:
            print(f"   Found {len(virtual_variations)} virtual/non-geographic locations to clean:")
            for city in sorted(virtual_variations):
                # Update to NULL - these will show in the virtual/non-geocode menu
                result = supabase.table('v2_events')\
                    .update({'city': None})\
                    .eq('city', city)\
                    .execute()
                count = len(result.data) if result.data else 0
                total_cleaned += count
                print(f"   - '{city}': {count} events → NULL (virtual/national)")
        
        # Also check for non-geographic states
        print("   Checking for non-geographic states...")
        all_states = supabase.table('v2_events')\
            .select('state')\
            .not_.is_('state', 'null')\
            .neq('state', '')\
            .execute()
        
        non_geo_states = set()
        for record in all_states.data:
            state = record.get('state', '')
            if state and any(pattern in state.lower() for pattern in [
                'national', 'nationwide', 'usa', 'united states',
                'multiple', 'various', 'virtual', 'online', 'remote',
                'multi-state', 'multistate', 'everywhere', 'n/a', 'tbd'
            ]):
                non_geo_states.add(state)
        
        if non_geo_states:
            print(f"   Found {len(non_geo_states)} non-geographic states to clean:")
            for state in sorted(non_geo_states):
                # Update to NULL - these will show in the virtual/non-geocode menu
                result = supabase.table('v2_events')\
                    .update({'state': None})\
                    .eq('state', state)\
                    .execute()
                count = len(result.data) if result.data else 0
                total_cleaned += count
                print(f"   - '{state}': {count} events → NULL (virtual/national)")
        
        if total_cleaned > 0:
            print(f"   ✅ Cleaned {total_cleaned} events total")
        else:
            print("   ✅ No non-geographic variations found")
            
    except Exception as e:
        print(f"   ⚠️ Error cleaning non-geographic locations: {e}")
    
    if use_cache:
        print("📦 Using location_coordinates table as cache")
    else:
        print("🌍 Bypassing cache, using direct geocoding")
    
    # Check how many events need coordinates (now truly excluding Unknown cities)
    try:
        needs_coords_result = supabase.table('v2_events')\
            .select('id', count='exact')\
            .is_('latitude', 'null')\
            .not_.is_('city', 'null')\
            .not_.is_('state', 'null')\
            .neq('city', 'Unknown')\
            .limit(1)\
            .execute()
        
        total_needing_coords = needs_coords_result.count or 0
        print(f"📊 Found {total_needing_coords} v2_events needing coordinates")
        
        if total_needing_coords == 0:
            print("✅ All v2_events already have coordinates! No backfill needed.")
            return True
            
    except Exception as e:
        print(f"❌ Error checking v2_events: {e}")
        return False

    # Get unique city/state combinations that need coordinates
    try:
        query = supabase.table('v2_events')\
            .select('city, state')\
            .is_('latitude', 'null')\
            .not_.is_('city', 'null')\
            .not_.is_('state', 'null')\
        
        print(f"🔄 Fetching all events needing coordinates...")
        all_events = fetch_all_rows(query, batch_size=1000)
        
        # Group by city, state
        unique_locations = {}
        unknown_count = 0
        for event in all_events:
            key = (event['city'], event['state'])
            if key not in unique_locations:
                unique_locations[key] = 0
            unique_locations[key] += 1
        
        if unknown_count > 0:
            print(f"🚫 Skipped {unknown_count} events with 'Unknown' cities")
        
        print(f"📍 Found {len(unique_locations)} unique city/state combinations to process")
        
        # Sort by frequency (most common first)
        sorted_locations = sorted(unique_locations.items(), key=lambda x: x[1], reverse=True)
        
        # Display top locations
        if sorted_locations:
            print("\n🏙️  Top locations to process:")
            for i, ((city, state), count) in enumerate(sorted_locations[:10]):
                print(f"   {i+1:2d}. {city}, {state} ({count} events)")
            
            if len(sorted_locations) > 10:
                print(f"   ... and {len(sorted_locations) - 10} more")
            
    except Exception as e:
        print(f"❌ Error getting unique locations: {e}")
        return False

    # Process each unique location
    updated_events = 0
    failed_locations = 0
    cached_hits = 0
    api_calls = 0
    
    print(f"\n🌍 Starting coordinate processing...")
    
    for i, ((city, state), event_count) in enumerate(sorted_locations):
        print(f"\n[{i+1}/{len(sorted_locations)}] Processing {city}, {state} ({event_count} events)...")
        
        lat, lon = None, None
        
        # Check cache first if enabled
        if use_cache:
            cached_coords = check_coordinates_cache(supabase, city, state)
            if cached_coords:
                lat, lon = cached_coords
                print(f"   📦 Found in cache: {lat:.4f}, {lon:.4f}")
                cached_hits += 1
        
        # If not in cache, geocode
        if lat is None or lon is None:
            try:
                coords = geocode_city_state(city, state)
                if coords:
                    lat, lon = coords
                    print(f"   🌍 Geocoded: {lat:.4f}, {lon:.4f}")
                    api_calls += 1
                    
                    # Save to cache for future use
                    if use_cache:
                        if save_to_coordinates_cache(supabase, city, state, lat, lon):
                            print(f"   💾 Saved to cache")
                else:
                    print(f"   ❌ Failed to geocode {city}, {state}")
                    failed_locations += 1
                    continue
                    
            except Exception as e:
                print(f"   ❌ Error geocoding {city}, {state}: {e}")
                failed_locations += 1
                continue
        
        # Update all events with this city/state
        if lat is not None and lon is not None:
            try:
                update_result = supabase.table('v2_events')\
                    .update({'latitude': lat, 'longitude': lon})\
                    .eq('city', city)\
                    .eq('state', state)\
                    .neq('city', 'Unknown')\
                    .is_('latitude', 'null')\
                    .execute()
                
                if update_result.data:
                    updated_count = len(update_result.data)
                    updated_events += updated_count
                    print(f"   📍 Updated {updated_count} events")
                else:
                    print(f"   ⚠️  No events updated (might already have coordinates)")
                    
            except Exception as e:
                print(f"   ❌ Error updating events: {e}")
        
        # Small delay to be nice to geocoding service (only if we made an API call)
        if api_calls > 0 and api_calls % 10 == 0:
            time.sleep(0.5)
    
    # Handle state-only events
    print(f"\n🏛️  Processing state-only events...")
    try:
        # Include both null cities AND 'Unknown' cities
        state_only_count_result = supabase.table('v2_events')\
            .select('id', count='exact')\
            .is_('latitude', 'null')\
            .not_.is_('state', 'null')\
            .or_('city.is.null,city.eq.Unknown')\
            .limit(1)\
            .execute()
        
        state_only_count = state_only_count_result.count or 0
        
        if state_only_count > 0:
            print(f"📊 Found {state_only_count} state-only events")
            
            # Get unique states
            query = supabase.table('v2_events')\
                .select('state')\
                .is_('latitude', 'null')\
                .not_.is_('state', 'null')\
                .or_('city.is.null,city.eq.Unknown')
            
            state_only_events = fetch_all_rows(query, batch_size=1000)
            
            unique_states = set()
            for event in state_only_events:
                unique_states.add(event['state'])
            
            print(f"🗺️  Found {len(unique_states)} unique states to process")
            
            for state in sorted(unique_states):
                print(f"\n   Processing state: {state}")
                
                lat, lon = None, None
                
                # Check cache for state coordinates
                if use_cache:
                    cached_coords = check_coordinates_cache(supabase, None, state)
                    if cached_coords:
                        lat, lon = cached_coords
                        print(f"      📦 Found in cache: {lat:.4f}, {lon:.4f}")
                        cached_hits += 1
                
                # If not in cache, geocode
                if lat is None or lon is None:
                    try:
                        coords = geocode_city_state("", state)
                        if coords:
                            lat, lon = coords
                            print(f"      🌍 Geocoded: {lat:.4f}, {lon:.4f}")
                            api_calls += 1
                            
                            # Save to cache
                            if use_cache:
                                if save_to_coordinates_cache(supabase, None, state, lat, lon):
                                    print(f"      💾 Saved to cache")
                        else:
                            print(f"      ❌ Failed to geocode state {state}")
                            failed_locations += 1
                            continue
                            
                    except Exception as e:
                        print(f"      ❌ Error geocoding state {state}: {e}")
                        failed_locations += 1
                        continue
                
                # Update state-only events
                if lat is not None and lon is not None:
                    try:
                        update_result = supabase.table('v2_events')\
                            .update({'latitude': lat, 'longitude': lon})\
                            .eq('state', state)\
                            .or_('city.is.null,city.eq.Unknown')\
                            .is_('latitude', 'null')\
                            .execute()
                        
                        if update_result.data:
                            state_updated = len(update_result.data)
                            updated_events += state_updated
                            print(f"      📍 Updated {state_updated} state-only events")
                            
                    except Exception as e:
                        print(f"      ❌ Error updating state events: {e}")
                
                if api_calls > 0 and api_calls % 10 == 0:
                    time.sleep(0.5)
        
    except Exception as e:
        print(f"❌ Error handling state-only events: {e}")

    # Final summary
    print(f"\n" + "="*60)
    print(f"📊 COORDINATE BACKFILL COMPLETE!")
    print("="*60)
    print(f"   ✅ Updated events: {updated_events}")
    print(f"   📦 Cache hits: {cached_hits}")
    print(f"   🌍 API calls: {api_calls}")
    print(f"   ❌ Failed locations: {failed_locations}")
    
    if len(sorted_locations) > 0:
        success_rate = (len(sorted_locations) - failed_locations) / len(sorted_locations) * 100
        print(f"   🎯 Success rate: {success_rate:.1f}%")
    
    if cached_hits > 0:
        cache_rate = cached_hits / (cached_hits + api_calls) * 100
        print(f"   💾 Cache hit rate: {cache_rate:.1f}%")
    
    # Verify results
    try:
        final_check = supabase.table('v2_events')\
            .select('id', count='exact')\
            .is_('latitude', 'null')\
            .not_.is_('city', 'null')\
            .not_.is_('state', 'null')\
            .neq('city', 'Unknown')\
            .limit(1)\
            .execute()
        
        remaining = final_check.count or 0
        
        if remaining > 0:
            print(f"\n⚠️  {remaining} city events still need coordinates")
        else:
            print(f"\n✅ All city events now have coordinates!")
            
    except Exception as e:
        print(f"\n⚠️  Error verifying results: {e}")
    
    # Refresh the materialized view to pick up all coordinate changes
    print(f"\n🔄 Refreshing materialized view to apply coordinate updates...")
    try:
        # Use RPC to refresh the materialized view
        refresh_result = supabase.rpc('refresh_map_view', {}).execute()
        print(f"✅ Map view refreshed successfully!")
    except Exception as refresh_error:
        # Try direct SQL as fallback
        try:
            import subprocess
            import os
            
            db_url = os.environ.get('DATABASE_URL')
            if db_url:
                cmd = ['psql', db_url, '-c', 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_events_map_points;']
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.returncode == 0:
                    print(f"✅ Map view refreshed successfully via psql!")
                else:
                    print(f"⚠️  Could not refresh map view automatically. Run manually:")
                    print(f"    psql $DATABASE_URL -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_events_map_points;'")
            else:
                print(f"⚠️  Could not refresh map view automatically. Run manually:")
                print(f"    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_events_map_points;")
        except Exception as e:
            print(f"⚠️  Could not refresh map view automatically: {e}")
            print(f"    Run manually: psql $DATABASE_URL -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_events_map_points;'")
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Enhanced coordinate backfill for v2_events using cache'
    )
    parser.add_argument(
        '--no-cache', 
        action='store_true',
        help='Bypass cache and use direct geocoding'
    )
    parser.add_argument(
        '--reset', 
        action='store_true',
        help='Clear all existing coordinates before backfilling'
    )
    parser.add_argument(
        '--clear-cache', 
        action='store_true',
        help='Clear the location_coordinates cache table (use with caution)'
    )
    
    args = parser.parse_args()
    
    if args.clear_cache:
        print("⚠️  WARNING: This will clear the entire location_coordinates cache!")
        response = input("Are you sure? (yes/no): ")
        if response.lower() == 'yes':
            supabase = get_supabase()
            try:
                # Only clear non-state entries to preserve our state centers
                result = supabase.table('location_coordinates')\
                    .delete()\
                    .neq('geocoding_source', 'state_center')\
                    .execute()
                print("✅ Cache cleared (preserved state centers)")
            except Exception as e:
                print(f"❌ Error clearing cache: {e}")
            return
        else:
            print("❌ Cache clear cancelled")
            return
    
    # Run the enhanced backfill
    success = backfill_v2_event_coordinates_enhanced(
        use_cache=not args.no_cache,
        reset=args.reset
    )
    
    if success:
        print("\n🎉 Backfill completed successfully!")
    else:
        print("\n❌ Backfill encountered errors")
        sys.exit(1)


if __name__ == "__main__":
    main()
