# Location Backfill Scripts

## backfill_coordinates.py

This is the most up-to-date script for backfilling location coordinates for events. It uses the `location_coordinates` table as a cache to avoid redundant geocoding API calls.

### Features
- Uses cached coordinates from `location_coordinates` table
- Falls back to Google Maps API for geocoding when not cached
- Saves new geocoded results to cache for future use
- Handles both city-level and state-level geocoding
- Includes retry logic and error handling
- Progress tracking and detailed output

### Prerequisites
1. Install required dependencies:
```bash
pip install supabase googlemaps python-dotenv
```

2. Ensure your `.env` file has the required keys:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
GOOGLE_MAPS_API_KEY=your_google_maps_key
```

### Usage

#### Basic usage (backfill all events without coordinates):
```bash
python scripts/backfill_coordinates.py
```

#### With options:
```bash
# Limit the number of events to process
python scripts/backfill_coordinates.py --limit 100

# Start from a specific offset
python scripts/backfill_coordinates.py --offset 500

# Force re-geocoding even if coordinates exist
python scripts/backfill_coordinates.py --force

# Test mode (doesn't save to database)
python scripts/backfill_coordinates.py --test

# Combine options
python scripts/backfill_coordinates.py --limit 50 --test
```

### Command-line Options
- `--limit`: Maximum number of events to process (default: no limit)
- `--offset`: Skip the first N events (default: 0)
- `--force`: Re-geocode events that already have coordinates
- `--test`: Run in test mode without saving to database
- `--batch-size`: Number of events to process at once (default: 100)

### What it does
1. **Fetches events** from the database that need coordinates
2. **Checks cache** in `location_coordinates` table for existing coordinates
3. **Geocodes** using Google Maps API if not cached
4. **Saves coordinates** to both the events table and cache table
5. **Reports progress** with detailed statistics

### Example Output
```
🔄 Starting coordinate backfill...
📊 Found 150 events to process

Processing batch 1-50 of 150...
  ✅ Phoenix, AZ - Using cached coordinates
  🌐 Tucson, AZ - Geocoded via Google Maps
  ⚠️  Unknown City, XX - Failed to geocode

Batch Summary:
  ✅ Successfully processed: 48
  ⚠️  Failed: 2
  📍 From cache: 35
  🌐 New geocodes: 13

Overall Progress: 50/150 (33.3%)
```

### Troubleshooting

**Issue: "No module named 'utils'"**
- Solution: Make sure you're running from the parent directory or update the import path

**Issue: "Google Maps API error"**
- Solution: Check your API key is valid and has the Geocoding API enabled
- Check you haven't exceeded quota limits

**Issue: "Supabase connection error"**
- Solution: Verify your SUPABASE_URL and SUPABASE_KEY are correct
- Check network connectivity

### Database Tables Used
- **events**: Table being updated with coordinates
- **location_coordinates**: Cache table for geocoded locations
  - Stores city/state to lat/lng mappings
  - Reduces API calls and costs
  - Improves performance for repeated locations

### Rate Limiting
The script includes built-in delays to respect API rate limits:
- 0.1 second delay between Google Maps API calls
- Batch processing to minimize database connections