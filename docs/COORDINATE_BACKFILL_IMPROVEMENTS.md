# Coordinate Backfill Performance & Accuracy Improvements

## Problem Statement

1. **Speed Issue**: 450+ events still need coordinates, processing is slow
2. **Venue Issue**: Specific locations like "ASU Memorial Union" don't geocode
3. **Cache Efficiency**: Cache is checked one-by-one instead of in batch

## Proposed Solutions

### Solution 1: Batch Cache Pre-loading (FASTEST - Implement First)

**Current Flow:**
```
For each location:
  - Check cache (1 query)
  - Geocode if needed (1 API call)
  - Update events (1 query)
```

**Improved Flow:**
```
1. Fetch ALL unique city/state pairs (1 query)
2. Fetch ALL cached coordinates for those pairs (1 query)
3. Identify missing locations
4. Geocode missing locations (N API calls)
5. Batch update events by location (chunked queries)
```

**Performance Gain:**
- Current: 450 locations × 2 queries = 900 queries
- New: 2 queries + 450 API calls + ~10 batch updates = ~462 queries
- **Savings: ~438 queries (48% reduction)**

**Implementation:**
```python
def preload_cache(supabase, location_pairs):
    """Fetch all cached coordinates in one query"""
    # Build OR conditions for all location pairs
    cache_results = {}

    # Query in batches of 100 to avoid URL limits
    for i in range(0, len(location_pairs), 100):
        batch = location_pairs[i:i+100]

        # Use PostgREST OR filter
        filters = ' or '.join([
            f"(city.eq.{city},state.eq.{state})"
            for city, state in batch
        ])

        result = supabase.table('location_coordinates')\
            .select('city, state, latitude, longitude')\
            .or_(filters)\
            .execute()

        for row in result.data:
            key = (row['city'], row['state'])
            cache_results[key] = (row['latitude'], row['longitude'])

    return cache_results
```

---

### Solution 2: Gemini-Based Venue Normalization

**Problem:** "ASU Memorial Union" → Can't geocode
**Solution:** Use Gemini to extract city/state from venue names

**Implementation:**
```python
def normalize_venues_with_gemini(supabase, batch_size=50):
    """
    Use Gemini to normalize venue names to city/state pairs
    """
    # Get events with specific venues (no coordinates, has location field)
    query = supabase.table('v2_events')\
        .select('id, location, city, state')\
        .is_('latitude', 'null')\
        .not_.is_('location', 'null')

    events = fetch_all_rows(query)

    # Group by location string
    location_groups = {}
    for event in events:
        loc = event['location']
        if loc not in location_groups:
            location_groups[loc] = []
        location_groups[loc].append(event['id'])

    # Process in batches with Gemini
    for i in range(0, len(location_groups), batch_size):
        batch_locations = list(location_groups.keys())[i:i+batch_size]

        prompt = f"""
Extract the city and state from these venue/location names.
Return ONLY valid city and state names (no venue names).

Locations:
{chr(10).join(f"{i+1}. {loc}" for i, loc in enumerate(batch_locations))}

Return JSON array:
[
  {{"location": "ASU Memorial Union", "city": "Tempe", "state": "Arizona"}},
  {{"location": "...", "city": "...", "state": "..."}}
]
"""

        response = model.generate_content(prompt)
        # Parse response and update events
```

**Example:**
- Input: "ASU Memorial Union, Tempe, AZ"
- Gemini Output: `{"city": "Tempe", "state": "Arizona"}`
- Update: Set city="Tempe", state="Arizona" in database
- Then: Regular geocoding can find coordinates

**Cost:** ~1 cent per 50 locations (using Gemini 2.5 Flash)

---

### Solution 3: Google Places API Venue Lookup

**Alternative:** Use Google Places API to find venue coordinates directly

```python
def geocode_venue(location_string):
    """
    Use Google Places API to find specific venues
    """
    import googlemaps

    gmaps = googlemaps.Client(key=GOOGLE_MAPS_API_KEY)

    # Places API search
    result = gmaps.places(location_string)

    if result['results']:
        place = result['results'][0]
        lat = place['geometry']['location']['lat']
        lng = place['geometry']['location']['lng']

        # Extract city from address components
        for component in place['address_components']:
            if 'locality' in component['types']:
                city = component['long_name']
            if 'administrative_area_level_1' in component['types']:
                state = component['long_name']

        return lat, lng, city, state

    return None
```

**Pros:**
- Most accurate for specific venues
- Gets exact coordinates for buildings
- Extracts normalized city/state automatically

**Cons:**
- More expensive ($17 per 1000 requests vs $5 for geocoding)
- May be overkill if we just need city-level accuracy

---

### Solution 4: Mapbox Forward Geocoding (Cheaper Alternative)

**Alternative:** Use Mapbox API instead of Google

```python
def mapbox_geocode_venue(location_string, state_hint=None):
    """
    Use Mapbox Forward Geocoding (cheaper than Google Places)
    """
    import requests

    # Mapbox Forward Geocoding API
    base_url = "https://api.mapbox.com/geocoding/v5/mapbox.places"

    # Add state as proximity hint if available
    params = {
        'access_token': MAPBOX_TOKEN,
        'types': 'poi,address,place',  # Points of interest, addresses, cities
        'country': 'US',
        'limit': 1
    }

    if state_hint:
        params['proximity'] = get_state_center(state_hint)  # Bias to state

    response = requests.get(f"{base_url}/{location_string}.json", params=params)

    if response.status_code == 200:
        data = response.json()
        if data['features']:
            feature = data['features'][0]
            lng, lat = feature['center']

            # Extract city and state from context
            for ctx in feature.get('context', []):
                if ctx['id'].startswith('place'):
                    city = ctx['text']
                elif ctx['id'].startswith('region'):
                    state = ctx['text']

            return lat, lng, city, state

    return None
```

**Cost Comparison:**
- Google Places: $17/1000 requests
- Mapbox Geocoding: $0.75/1000 requests (**23x cheaper**)
- Google Geocoding: $5/1000 requests

---

## Recommended Implementation Order

### Phase 1: Speed Improvements (Implement Today)
1. ✅ Batch cache pre-loading (biggest speed gain)
2. ✅ Batch event updates (update multiple locations at once)

### Phase 2: Venue Normalization (Next)
Choose ONE approach:

**Option A: Gemini Normalization** (Recommended)
- Pros: Cheap, flexible, can handle any format
- Cons: Requires LLM call, may need validation
- Use case: Good for extracting city/state from text

**Option B: Mapbox Forward Geocoding** (Best Value)
- Pros: Very cheap, accurate, fast
- Cons: Requires new API key/account
- Use case: Best for specific venue lookups

**Option C: Google Places API** (Most Accurate)
- Pros: Most accurate, comprehensive
- Cons: Most expensive
- Use case: When precision matters most

### Phase 3: Hybrid Approach (Ideal)
```python
def smart_geocode(location, city, state):
    """
    1. Try cache first (free, instant)
    2. If city/state exist: use regular geocoding ($5/1000)
    3. If only location exists: use Gemini to extract city/state ($0.20/1000)
    4. Then geocode the normalized city/state
    5. For critical events: use Mapbox for venue-level accuracy ($0.75/1000)
    """
```

---

## Expected Results

**Before:**
- 450 events without coordinates
- ~15-20 minutes to process
- Many venues fail to geocode

**After Phase 1:**
- Same 450 events
- ~3-5 minutes to process (**75% faster**)
- Same failures (no accuracy improvement yet)

**After Phase 2 (with Gemini):**
- ~400-420 events successfully geocoded (**90%+ coverage**)
- Additional ~5 minutes for Gemini processing
- Total: ~8-10 minutes for complete backfill

**After Phase 2 (with Mapbox):**
- ~430-440 events successfully geocoded (**95%+ coverage**)
- Additional ~2 minutes for Mapbox calls
- Total: ~5-7 minutes for complete backfill

---

## Implementation Priority

**Do First (Today):**
- [ ] Implement batch cache preloading
- [ ] Test with current 450 events
- [ ] Measure speed improvement

**Do Next (This Week):**
- [ ] Choose: Gemini vs Mapbox approach
- [ ] Implement venue normalization
- [ ] Test on failed locations
- [ ] Measure coverage improvement

**Optional (Future):**
- [ ] Add fuzzy matching for common typos
- [ ] Add manual overrides table for problematic venues
- [ ] Add confidence scores for geocoded locations
