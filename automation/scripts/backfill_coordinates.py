"""
Enhanced coordinate backfill script with batch cache optimization and Gemini venue normalization
"""
import sys
import argparse
import json
from pathlib import Path
import time
from datetime import datetime
from collections import defaultdict
import google.generativeai as genai

# Ensure imports work when run from repo root
CURR = Path(__file__).resolve()
SCRIPTS_DIR = CURR.parent
AUTOMATION_DIR = SCRIPTS_DIR.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

# Prefer repo root, then web/, then analytics-ui/, then scripts/
for p in [str(REPO_ROOT), str(WEB_DIR), str(ANALYTICS_UI_DIR), str(SCRIPTS_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from utils.database import get_supabase, fetch_all_rows
from utils.geocoding import geocode_city_state
from config.settings import GOOGLE_API_KEY

# Configure Gemini
genai.configure(api_key=GOOGLE_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')


def preload_cache_batch(supabase, location_pairs):
    """
    Preload ALL cached coordinates with pagination support.
    Returns dict: {(city, state): (lat, lon)}
    """
    print(f"📦 Preloading cache for {len(location_pairs)} locations...")
    cache_dict = {}

    if not location_pairs:
        return cache_dict

    try:
        # Use fetch_all_rows to handle pagination automatically
        query = supabase.table('location_coordinates')\
            .select('city, state, latitude, longitude, location_type')

        all_cached = fetch_all_rows(query, batch_size=1000)

        # Build lookup dict
        for row in all_cached:
            city = row.get('city')
            state = row.get('state')
            key = (city, state)
            cache_dict[key] = (float(row['latitude']), float(row['longitude']))

        print(f"   ✅ Loaded {len(cache_dict)} cached coordinates")

    except Exception as e:
        print(f"   ⚠️  Error preloading cache: {e}")

    return cache_dict


def batch_save_to_cache(supabase, locations_coords):
    """
    Save multiple coordinates to cache in optimized batches.
    Requires unique constraint on (city, state) - see sql/add_location_coordinates_constraint.sql
    locations_coords: list of (city, state, lat, lon)
    """
    if not locations_coords:
        return 0

    saved_count = 0
    batch_size = 50

    for i in range(0, len(locations_coords), batch_size):
        batch = locations_coords[i:i+batch_size]

        try:
            # Prepare batch insert data
            insert_data = []
            for city, state, lat, lon in batch:
                location_type = 'city' if city else 'state'
                insert_data.append({
                    'city': city,
                    'state': state,
                    'location_type': location_type,
                    'latitude': lat,
                    'longitude': lon,
                    'geocoding_source': 'google',
                    'confidence_score': 0.95,
                    'last_verified': datetime.now().isoformat()
                })

            # Upsert batch (requires unique constraint on city, state)
            result = supabase.table('location_coordinates').upsert(
                insert_data,
                on_conflict='city,state'
            ).execute()

            saved_count += len(result.data) if result.data else 0

        except Exception as e:
            # If upsert fails (constraint not added yet), fall back to individual inserts
            print(f"   ⚠️  Batch upsert failed (add constraint with sql/add_location_coordinates_constraint.sql)")
            for city, state, lat, lon in batch:
                try:
                    save_to_coordinates_cache(supabase, city, state, lat, lon)
                    saved_count += 1
                except:
                    pass

    return saved_count


def save_to_coordinates_cache(supabase, city, state, latitude, longitude, source='google'):
    """Save single coordinate to cache (fallback for batch failures)"""
    try:
        location_type = 'city' if city else 'state'

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

        result = supabase.table('location_coordinates').upsert(data, on_conflict='city,state').execute()
        return True
    except Exception as e:
        print(f"   ⚠️  Error saving to cache: {e}")
        return False


def normalize_venues_with_gemini(supabase, batch_size=50):
    """
    Use Gemini to normalize venue names to proper city/state pairs.
    Returns count of events normalized.
    """
    print("\n🤖 Normalizing venue names with Gemini...")

    # Find events with location field but no coordinates
    # These likely have venue names instead of cities
    try:
        query = supabase.table('v2_events')\
            .select('id, location, city, state')\
            .is_('latitude', 'null')\
            .not_.is_('location', 'null')

        print("   🔍 Fetching events with venue locations...")
        events = fetch_all_rows(query, batch_size=1000)

        if not events:
            print("   ✅ No venue locations found to normalize")
            return 0

        print(f"   📋 Found {len(events)} events with location data")

        # Group by location string to avoid duplicate Gemini calls
        # Also filter out virtual/non-geocoded patterns
        virtual_patterns = [
            'unknown', 'virtual', 'online', 'nationwide', 'national',
            'remote', 'multi-state', 'multistate', 'multiple states',
            'multiple cities', 'various', 'everywhere', 'anywhere',
            'n/a', 'tbd', 'usa', 'united states'
        ]

        location_groups = defaultdict(list)
        virtual_event_ids = []

        for event in events:
            loc = event.get('location', '').strip()
            if loc and loc != event.get('city', ''):  # Only if location differs from city
                # Check if it's a virtual/non-geocoded pattern
                loc_lower = loc.lower()
                if any(pattern in loc_lower for pattern in virtual_patterns):
                    virtual_event_ids.append(event['id'])
                else:
                    location_groups[loc].append(event['id'])

        # Clean up virtual event IDs first (in batches to avoid header size limits)
        if virtual_event_ids:
            print(f"   🧹 Found {len(virtual_event_ids)} virtual/non-geocoded events to clean...")
            # Set both city and state to NULL for virtual events
            cleaned_total = 0
            batch_size = 100

            for i in range(0, len(virtual_event_ids), batch_size):
                batch = virtual_event_ids[i:i+batch_size]
                try:
                    result = supabase.table('v2_events')\
                        .update({'city': None, 'state': None})\
                        .in_('id', batch)\
                        .execute()
                    cleaned_total += len(result.data) if result.data else 0
                except Exception as e:
                    print(f"   ⚠️  Error cleaning batch {i//batch_size + 1}: {e}")

            print(f"   ✅ Cleaned {cleaned_total} virtual events (set city/state to NULL)")

        print(f"   📍 Found {len(location_groups)} unique venue names (after filtering virtual)")

        if not location_groups:
            print("   ✅ No venues to normalize")
            return len(virtual_event_ids) if virtual_event_ids else 0

        # Show sample
        sample_venues = list(location_groups.keys())[:10]
        print(f"\n   📝 Sample venues to normalize:")
        for venue in sample_venues:
            count = len(location_groups[venue])
            print(f"      • {venue} ({count} events)")
        if len(location_groups) > 10:
            print(f"      ... and {len(location_groups) - 10} more")

        # Process in batches with Gemini
        normalized_count = 0
        gemini_calls = 0
        failed_venues = []

        location_list = list(location_groups.items())

        for i in range(0, len(location_list), batch_size):
            batch = location_list[i:i+batch_size]
            batch_locations = [loc for loc, _ in batch]

            print(f"\n   [{i+1}-{min(i+batch_size, len(location_list))}/{len(location_list)}] Processing batch with Gemini...")

            # Build prompt
            prompt = f"""Extract the city and state from these venue/location names.
For each location, provide ONLY the official city name and state (not venue names, not abbreviations).
If you cannot determine the city/state, return null for both.

Locations:
{chr(10).join(f"{j+1}. {loc}" for j, loc in enumerate(batch_locations))}

Return ONLY valid JSON array (no markdown, no explanation):
[
  {{"location": "location 1", "city": "CityName", "state": "StateName"}},
  {{"location": "location 2", "city": "CityName", "state": "StateName"}}
]

Rules:
- Use full state names (e.g., "Arizona" not "AZ")
- Use official city names (e.g., "Tempe" not "ASU")
- Return null if you cannot determine city/state with confidence
"""

            try:
                response = model.generate_content(prompt)
                response_text = response.text.strip()
                gemini_calls += 1

                # Extract JSON from response
                if '```json' in response_text:
                    json_str = response_text.split('```json')[1].split('```')[0].strip()
                elif '```' in response_text:
                    json_str = response_text.split('```')[1].split('```')[0].strip()
                elif '[' in response_text and ']' in response_text:
                    start = response_text.index('[')
                    end = response_text.rindex(']') + 1
                    json_str = response_text[start:end]
                else:
                    print(f"      ⚠️  Could not parse Gemini response")
                    continue

                results = json.loads(json_str)

                # Process each normalized result
                for result in results:
                    venue_name = result.get('location', '')
                    city = result.get('city')
                    state = result.get('state')

                    if not city or not state or city == 'null' or state == 'null':
                        failed_venues.append(venue_name)
                        continue

                    # Get event IDs for this venue
                    event_ids = location_groups.get(venue_name, [])
                    if not event_ids:
                        continue

                    # Update events in database
                    try:
                        update_result = supabase.table('v2_events')\
                            .update({'city': city, 'state': state})\
                            .in_('id', event_ids)\
                            .execute()

                        if update_result.data:
                            count = len(update_result.data)
                            normalized_count += count
                            print(f"      ✅ {venue_name[:60]} → {city}, {state} ({count} events)")

                    except Exception as e:
                        print(f"      ❌ Error updating {venue_name}: {e}")
                        failed_venues.append(venue_name)

                # Rate limiting
                if gemini_calls % 5 == 0:
                    time.sleep(1)

            except Exception as e:
                print(f"      ❌ Gemini error: {e}")
                # Add all venues in batch to failed list
                failed_venues.extend(batch_locations)
                continue

        print(f"\n   📊 Venue Normalization Summary:")
        print(f"      ✅ Normalized: {normalized_count} events")
        print(f"      🤖 Gemini calls: {gemini_calls}")
        print(f"      ❌ Failed venues: {len(failed_venues)}")

        if failed_venues and len(failed_venues) <= 20:
            print(f"\n   ⚠️  Failed to normalize:")
            for venue in failed_venues[:20]:
                print(f"      • {venue}")

        return normalized_count

    except Exception as e:
        print(f"   ❌ Error in venue normalization: {e}")
        return 0


def batch_update_events(supabase, updates):
    """
    Batch update events with coordinates.
    updates: dict of {(city, state): (lat, lon)}
    Returns count of updated events.
    """
    if not updates:
        return 0

    print(f"📍 Batch updating {len(updates)} locations...")

    total_updated = 0

    # Process in chunks of 10 locations at a time
    chunk_size = 10
    items = list(updates.items())

    for i in range(0, len(items), chunk_size):
        chunk = items[i:i+chunk_size]

        for (city, state), (lat, lon) in chunk:
            try:
                # Update all events with this city/state
                update_result = supabase.table('v2_events')\
                    .update({'latitude': lat, 'longitude': lon})\
                    .eq('city', city)\
                    .eq('state', state)\
                    .is_('latitude', 'null')\
                    .execute()

                if update_result.data:
                    count = len(update_result.data)
                    total_updated += count

            except Exception as e:
                print(f"   ⚠️  Error updating {city}, {state}: {e}")

    return total_updated


def backfill_v2_event_coordinates_enhanced(use_cache=True, normalize_venues=True, reset=False):
    """
    Enhanced backfill with batch optimizations and Gemini venue normalization.
    """
    supabase = get_supabase()

    print("🗺️  Starting OPTIMIZED coordinate backfill for v2_events...")
    print(f"   📦 Cache: {'Enabled' if use_cache else 'Disabled'}")
    print(f"   🤖 Venue normalization: {'Enabled' if normalize_venues else 'Disabled'}")

    # Step 0: Clean up virtual/non-geocoded locations
    print("\n🧹 Cleaning up virtual/non-geocoded locations...")
    try:
        # Patterns for virtual/non-geocoded cities
        virtual_city_patterns = [
            'unknown', 'unspecified', 'virtual', 'online', 'nationwide', 'national',
            'remote', 'multi-state', 'multistate', 'multiple states',
            'multiple cities', 'various', 'everywhere', 'anywhere',
            'n/a', 'tbd', 'usa', 'united states'
        ]

        # Valid US states (full names and abbreviations)
        valid_states = {
            'alabama', 'al', 'alaska', 'ak', 'arizona', 'az', 'arkansas', 'ar',
            'california', 'ca', 'colorado', 'co', 'connecticut', 'ct', 'delaware', 'de',
            'florida', 'fl', 'georgia', 'ga', 'hawaii', 'hi', 'idaho', 'id',
            'illinois', 'il', 'indiana', 'in', 'iowa', 'ia', 'kansas', 'ks',
            'kentucky', 'ky', 'louisiana', 'la', 'maine', 'me', 'maryland', 'md',
            'massachusetts', 'ma', 'michigan', 'mi', 'minnesota', 'mn', 'mississippi', 'ms',
            'missouri', 'mo', 'montana', 'mt', 'nebraska', 'ne', 'nevada', 'nv',
            'new hampshire', 'nh', 'new jersey', 'nj', 'new mexico', 'nm', 'new york', 'ny',
            'north carolina', 'nc', 'north dakota', 'nd', 'ohio', 'oh', 'oklahoma', 'ok',
            'oregon', 'or', 'pennsylvania', 'pa', 'rhode island', 'ri', 'south carolina', 'sc',
            'south dakota', 'sd', 'tennessee', 'tn', 'texas', 'tx', 'utah', 'ut',
            'vermont', 'vt', 'virginia', 'va', 'washington', 'wa', 'west virginia', 'wv',
            'wisconsin', 'wi', 'wyoming', 'wy', 'district of columbia', 'dc'
        }

        # Get all events with city/state combinations
        all_events_result = supabase.table('v2_events')\
            .select('id, city, state')\
            .not_.is_('city', 'null')\
            .execute()

        statewide_event_ids = []  # Has valid state, clear city only
        national_event_ids = []   # No valid state, clear both

        for record in all_events_result.data:
            city = record.get('city') or ''
            state = record.get('state') or ''
            event_id = record.get('id')

            # Strip whitespace if not None
            city = city.strip() if city else ''
            state = state.strip() if state else ''

            if not city:
                continue

            city_lower = city.lower()

            # Check if city matches virtual patterns
            if any(pattern in city_lower for pattern in virtual_city_patterns):
                # Check if state is valid
                state_lower = state.lower() if state else ''
                if state and state_lower in valid_states:
                    # Valid state → statewide event (clear city only)
                    statewide_event_ids.append(event_id)
                else:
                    # Invalid/no state → national event (clear both)
                    national_event_ids.append(event_id)

        # Process statewide events (clear city only)
        if statewide_event_ids:
            print(f"   🏛️  Found {len(statewide_event_ids)} statewide events (clearing city, keeping state)...")
            cleaned = 0
            batch_size = 100
            for i in range(0, len(statewide_event_ids), batch_size):
                batch = statewide_event_ids[i:i+batch_size]
                try:
                    result = supabase.table('v2_events')\
                        .update({'city': None})\
                        .in_('id', batch)\
                        .execute()
                    cleaned += len(result.data) if result.data else 0
                except Exception as e:
                    print(f"      ⚠️  Error cleaning statewide batch: {e}")
            print(f"      ✅ {cleaned} events → statewide (will get state coordinates)")

        # Process national events (clear both city and state)
        if national_event_ids:
            print(f"   🌎 Found {len(national_event_ids)} national/virtual events (clearing city and state)...")
            cleaned = 0
            batch_size = 100
            for i in range(0, len(national_event_ids), batch_size):
                batch = national_event_ids[i:i+batch_size]
                try:
                    result = supabase.table('v2_events')\
                        .update({'city': None, 'state': None})\
                        .in_('id', batch)\
                        .execute()
                    cleaned += len(result.data) if result.data else 0
                except Exception as e:
                    print(f"      ⚠️  Error cleaning national batch: {e}")
            print(f"      ✅ {cleaned} events → national/virtual (no coordinates)")

        if not statewide_event_ids and not national_event_ids:
            print(f"   ✅ No virtual/non-geocoded cities found")

    except Exception as e:
        print(f"   ⚠️  Error cleaning virtual locations: {e}")

    # Step 1: Normalize venues with Gemini (if enabled)
    if normalize_venues:
        normalized_count = normalize_venues_with_gemini(supabase)
        if normalized_count > 0:
            print(f"\n   ✅ Normalized {normalized_count} venue locations")

    # Step 2: Get all unique city/state combinations needing coordinates
    print(f"\n🔄 Fetching events needing coordinates...")

    try:
        query = supabase.table('v2_events')\
            .select('city, state')\
            .is_('latitude', 'null')\
            .not_.is_('city', 'null')\
            .not_.is_('state', 'null')

        all_events = fetch_all_rows(query, batch_size=1000)

        # Group by city, state
        unique_locations = {}
        for event in all_events:
            key = (event['city'], event['state'])
            if key not in unique_locations:
                unique_locations[key] = 0
            unique_locations[key] += 1

        print(f"   ✅ Found {len(unique_locations)} unique city/state combinations")
        print(f"   📊 Total events needing coordinates: {sum(unique_locations.values())}")

        if not unique_locations:
            print("\n✅ All events already have coordinates!")
            return True

        # Show top locations
        sorted_locations = sorted(unique_locations.items(), key=lambda x: x[1], reverse=True)
        print(f"\n   🏙️  Top 10 locations:")
        for i, ((city, state), count) in enumerate(sorted_locations[:10]):
            print(f"      {i+1:2d}. {city}, {state} ({count} events)")
        if len(sorted_locations) > 10:
            print(f"      ... and {len(sorted_locations) - 10} more")

    except Exception as e:
        print(f"   ❌ Error fetching events: {e}")
        return False

    # Step 3: Preload cache for ALL locations in one batch
    cache_dict = {}
    if use_cache:
        location_pairs = list(unique_locations.keys())
        cache_dict = preload_cache_batch(supabase, location_pairs)

    # Step 4: Identify which locations need geocoding
    locations_to_geocode = []
    locations_with_coords = {}

    for (city, state), count in unique_locations.items():
        if (city, state) in cache_dict:
            # Already in cache
            locations_with_coords[(city, state)] = cache_dict[(city, state)]
        else:
            # Needs geocoding
            locations_to_geocode.append((city, state))

    print(f"\n   📦 Cache hits: {len(locations_with_coords)}")
    print(f"   🌍 Need geocoding: {len(locations_to_geocode)}")

    # Step 5: Geocode missing locations
    newly_geocoded = {}
    failed_locations = []

    if locations_to_geocode:
        print(f"\n🌍 Geocoding {len(locations_to_geocode)} locations...")

        for i, (city, state) in enumerate(locations_to_geocode):
            try:
                coords = geocode_city_state(city, state)
                if coords:
                    lat, lon = coords
                    newly_geocoded[(city, state)] = (lat, lon)
                    locations_with_coords[(city, state)] = (lat, lon)

                    if (i + 1) % 10 == 0:
                        print(f"   [{i+1}/{len(locations_to_geocode)}] Geocoded {len(newly_geocoded)} locations...")
                else:
                    failed_locations.append((city, state))
                    print(f"   ❌ Failed to geocode: {city}, {state}")

            except Exception as e:
                print(f"   ❌ Error geocoding {city}, {state}: {e}")
                failed_locations.append((city, state))

            # Rate limiting
            if (i + 1) % 10 == 0:
                time.sleep(0.5)

        print(f"\n   ✅ Geocoded {len(newly_geocoded)} new locations")
        print(f"   ❌ Failed: {len(failed_locations)}")

        if failed_locations and len(failed_locations) <= 20:
            print(f"\n   Failed locations:")
            for city, state in failed_locations[:20]:
                print(f"      • {city}, {state}")

        # Save newly geocoded to cache in batch
        if use_cache and newly_geocoded:
            print(f"\n   💾 Saving {len(newly_geocoded)} new coordinates to cache...")
            cache_data = [(city, state, lat, lon) for (city, state), (lat, lon) in newly_geocoded.items()]
            saved = batch_save_to_cache(supabase, cache_data)
            print(f"   ✅ Saved {saved} to cache")

    # Step 6: Batch update all events with coordinates
    print(f"\n📍 Updating events with coordinates...")
    updated_count = batch_update_events(supabase, locations_with_coords)
    print(f"   ✅ Updated {updated_count} events")

    # Step 7: Handle state-only events
    print(f"\n🏛️  Processing state-only events...")
    try:
        state_only_result = supabase.table('v2_events')\
            .select('state')\
            .is_('latitude', 'null')\
            .not_.is_('state', 'null')\
            .is_('city', 'null')\
            .execute()

        state_only_events = state_only_result.data
        unique_states = set(event['state'] for event in state_only_events)

        if unique_states:
            print(f"   📊 Found {len(unique_states)} states with state-only events")

            state_updates = {}
            for state in unique_states:
                # Check cache for state coords
                if (None, state) in cache_dict:
                    state_updates[state] = cache_dict[(None, state)]
                else:
                    # Geocode state
                    try:
                        coords = geocode_city_state("", state)
                        if coords:
                            state_updates[state] = coords
                            # Save to cache
                            if use_cache:
                                save_to_coordinates_cache(supabase, None, state, coords[0], coords[1])
                    except:
                        pass

            # Update state-only events
            state_updated = 0
            for state, (lat, lon) in state_updates.items():
                try:
                    result = supabase.table('v2_events')\
                        .update({'latitude': lat, 'longitude': lon})\
                        .eq('state', state)\
                        .is_('city', 'null')\
                        .is_('latitude', 'null')\
                        .execute()

                    if result.data:
                        state_updated += len(result.data)
                except:
                    pass

            print(f"   ✅ Updated {state_updated} state-only events")

    except Exception as e:
        print(f"   ⚠️  Error processing state-only events: {e}")

    # Final summary
    print(f"\n" + "="*70)
    print(f"📊 OPTIMIZED COORDINATE BACKFILL COMPLETE!")
    print("="*70)
    print(f"   ✅ Total events updated: {updated_count}")
    print(f"   📦 Locations from cache: {len(locations_with_coords) - len(newly_geocoded)}")
    print(f"   🌍 Locations geocoded: {len(newly_geocoded)}")
    print(f"   ❌ Failed locations: {len(failed_locations)}")

    if failed_locations:
        print(f"\n   ⚠️  Failed locations (first 10):")
        for city, state in failed_locations[:10]:
            print(f"      • {city}, {state}")

    # Verify results
    try:
        final_check = supabase.table('v2_events')\
            .select('id', count='exact')\
            .is_('latitude', 'null')\
            .not_.is_('city', 'null')\
            .not_.is_('state', 'null')\
            .limit(1)\
            .execute()

        remaining = final_check.count or 0

        if remaining > 0:
            print(f"\n⚠️  {remaining} events still need coordinates")
        else:
            print(f"\n✅ All city/state events now have coordinates!")

    except Exception as e:
        print(f"\n⚠️  Error verifying results: {e}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description='Optimized coordinate backfill with Gemini venue normalization'
    )
    parser.add_argument(
        '--no-cache',
        action='store_true',
        help='Bypass cache and use direct geocoding'
    )
    parser.add_argument(
        '--no-venues',
        action='store_true',
        help='Skip Gemini venue normalization'
    )
    parser.add_argument(
        '--reset',
        action='store_true',
        help='Clear all existing coordinates before backfilling'
    )

    args = parser.parse_args()

    # Run the enhanced backfill
    success = backfill_v2_event_coordinates_enhanced(
        use_cache=not args.no_cache,
        normalize_venues=not args.no_venues,
        reset=args.reset
    )

    if success:
        print("\n🎉 Backfill completed successfully!")
    else:
        print("\n❌ Backfill encountered errors")
        sys.exit(1)


if __name__ == "__main__":
    main()
