# Testing Automation Pipeline Locally

This guide walks you through testing the automation pipeline on your local machine before deploying to production.

## Prerequisites

1. **Environment variables set** in `.env` (already configured with conservative test values)
2. **Python environment** with all dependencies installed
3. **Database access** to your Supabase instance
4. **API keys** for Gemini, OpenAI, etc.

## Current Test Configuration

Your `.env` is already set with conservative values for testing:

```bash
AUTOMATION_EVENT_POSTS_LIMIT=300      # Process max 300 posts
AUTOMATION_DEDUP_EVENTS_LIMIT=20      # Check max 20 events for duplicates
AUTOMATION_MEDIA_BATCH_SIZE=50        # Download max 50 media files
AUTOMATION_EVENT_MAX_WORKERS=3        # Use 3 parallel workers (gentle on API)
AUTOMATION_WORKER_COOLDOWN=90         # 90 seconds between API calls
```

## Testing Individual Scripts

### 1. Test Event Processor (Extract events from posts)

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Test with your configured limits (300 posts max)
python automation/processors/flash_standalone_event_processor.py \
  --max-workers 3 \
  --cooldown-seconds 90 \
  --job-limit 300
```

**What it does:**
- Fetches up to 300 unprocessed posts from database
- Extracts events using Gemini Flash
- Creates entries in `v2_events` table
- Links events to posts and actors

**Expected duration:** ~10-20 minutes for 300 posts

### 2. Test Event Deduplicator

```bash
# Test with your configured limits (20 events max)
python automation/scripts/deduplicate_events_with_gemini.py \
  --limit 20 \
  --recent-days 30 \
  --verbose \
  --live \
  --yes \
  --once
```

**What it does:**
- Fetches up to 20 recent events (last 30 days)
- Finds potential duplicates using similarity search
- Uses Gemini to intelligently determine if they're duplicates
- Merges duplicate events (combines posts, actors, tags)

**Expected duration:** ~5-10 minutes for 20 events

**Flags explained:**
- `--limit 20` - Process max 20 events
- `--recent-days 30` - Only look at events from last 30 days
- `--verbose` - Show detailed output
- `--live` - Actually perform merges (not dry run)
- `--yes` - Skip confirmation prompts
- `--once` - Run once and exit (don't loop)

### 3. Test Profile Scraper

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring

# Scrapes both unknown actors and known actors missing profile data
python scrapers/profile_scraper.py
```

**What it does:**
- Scrapes Twitter profiles for unknown actors (from `unknown_actors` table)
- Scrapes profiles for known actors missing data (from `v2_actors` table)
- Prioritizes high-mention/high-post actors
- Updates `x_profile_data` and `about` fields

**Expected duration:** ~5-15 minutes depending on actor count

### 4. Test Coordinate Backfill

```bash
python automation/scripts/backfill_coordinates.py
```

**What it does:**
- Finds events and actors with missing coordinates
- Uses Google Maps API to geocode locations
- Updates lat/lon fields for map display

## Testing Full Pipeline Worker

The pipeline worker runs all scripts in sequence, just like production:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Make sure environment variables are loaded
source .env  # or: export $(cat .env | xargs)

# Run the pipeline worker
python automation/worker/pipeline_worker.py
```

**What it does:**
1. Polls database for queued automation runs
2. Executes each step sequentially:
   - Twitter scraping
   - Instagram scraping (if enabled)
   - Post processing
   - Media download
   - Event extraction
   - Event deduplication
   - Profile scraping
   - Coordinate backfill
3. Updates run status in database
4. Streams logs to database

**Note:** The worker needs an actual `automation_runs` entry in the database. To create one, either:
- Use the UI at `/automation` and click "Run Pipeline Now"
- Or manually insert a row in `automation_runs` table with `status='queued'`

## Testing API Endpoints Locally

### Start the Vercel dev server:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
npm run dev
```

This starts:
- Vite dev server on port 5173 (frontend)
- Vercel functions on port 3000 (API routes)

### Test automation API endpoints:

```bash
# Get automation config
curl http://localhost:3000/api/automation/config

# Trigger a manual run
curl -X POST http://localhost:3000/api/automation/run \
  -H "Content-Type: application/json" \
  -d '{"include_instagram": false}'

# Get run history
curl http://localhost:3000/api/automation/runs

# Test cron endpoint (requires AUTOMATION_CRON_SECRET)
curl -X GET http://localhost:3000/api/automation/advance \
  -H "x-vercel-cron-secret: your_secret_here"
```

## Monitoring Test Runs

### Check Database:

1. **automation_runs table**: See run status and logs
2. **v2_events table**: See newly extracted events
3. **v2_event_post_links**: See event-to-post connections
4. **unknown_actors table**: See newly discovered actors with profile data

### Check Supabase Storage:

Look for uploaded files in:
- `twitter_raw/` - Raw tweet JSON
- `instagram_raw/` - Raw Instagram post JSON
- `processed_posts/` - Normalized post data

## Common Issues

### Issue: "No posts found for processing"
**Solution:** Make sure you have unprocessed posts in the database with `event_extraction_status = 'pending'`

### Issue: "Gemini quota exceeded"
**Solution:** Reduce `AUTOMATION_EVENT_MAX_WORKERS` or increase `AUTOMATION_WORKER_COOLDOWN`

### Issue: "Database connection failed"
**Solution:** Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`

### Issue: Scripts can't find imports
**Solution:** Run from the correct directory and ensure Python path is set:
```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
```

## Scaling Up for Production

Once testing looks good, update your `.env` with production values:

```bash
# Production values (for daily runs)
AUTOMATION_EVENT_POSTS_LIMIT=1000
AUTOMATION_DEDUP_EVENTS_LIMIT=500
AUTOMATION_MEDIA_BATCH_SIZE=200
AUTOMATION_EVENT_MAX_WORKERS=6
AUTOMATION_WORKER_COOLDOWN=60
```

## Next Steps

1. ✅ Test individual scripts locally
2. ✅ Verify database updates are correct
3. ✅ Check API costs and quotas
4. ✅ Run full pipeline worker test
5. Deploy to production and enable cron job
