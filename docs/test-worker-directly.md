# Testing the Automation Worker Directly

This guide shows you how to test the complete automation pipeline worker (`pipeline_worker.py`) locally, simulating what happens when the Vercel cron job triggers.

## What the Cron Job Does

When Vercel cron runs daily at 6am UTC, it:
1. Calls `GET /api/automation/advance`
2. That endpoint creates an `automation_runs` row with `status='queued'`
3. The `pipeline_worker.py` script (running continuously) polls the database
4. When it finds the queued run, it executes all pipeline steps sequentially

## Prerequisites

Before testing, ensure:

1. **Environment variables are loaded**
   ```bash
   cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
   export $(cat .env | grep -v '^#' | xargs)
   ```

2. **Database access works** (test with):
   ```bash
   python -c "from scripts.utils.database import get_supabase; print(get_supabase().table('automation_settings').select('*').limit(1).execute())"
   ```

3. **Python dependencies installed**
   ```bash
   pip install -r requirements.txt  # Or use your existing environment
   ```

## Option 1: Test Worker + API Together (Recommended)

This simulates the full production flow.

### Step 1: Start the worker in one terminal

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Make sure environment is loaded
export $(cat .env | grep -v '^#' | xargs)

# Start the worker
python automation/worker/pipeline_worker.py
```

You should see:
```
⌛ No queued runs. Sleeping for 60 seconds...
```

### Step 2: Trigger a run via API (in another terminal)

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Start the dev server (includes API routes)
npm run dev
```

Then in a third terminal:

```bash
# Trigger a manual run via API
curl -X POST http://localhost:3000/api/automation/run \
  -H "Content-Type: application/json" \
  -d '{"include_instagram": false}'
```

### Step 3: Watch the worker execute

In the worker terminal, you should see:
```
🏁 Starting automation run <run-id>
➡️  Starting step: twitter_scrape
    Command: python automation/scrapers/twitter_scraper.py
[twitter_scrape] ...output...
⬅️  Step twitter_scrape finished with status completed
...
✅ Automation run <run-id> completed successfully
```

## Option 2: Test Worker Alone (Manual Database Entry)

If you just want to test the worker without the API:

### Step 1: Create a queued run manually

```bash
# Using psql or Supabase SQL Editor, run:
INSERT INTO automation_runs (status, include_instagram, step_states)
VALUES ('queued', false, '{}');
```

Or via Python:

```python
from scripts.utils.database import get_supabase
supabase = get_supabase()
supabase.table('automation_runs').insert({
    'status': 'queued',
    'include_instagram': False,
    'step_states': {}
}).execute()
```

### Step 2: Run the worker

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
export $(cat .env | grep -v '^#' | xargs)
python automation/worker/pipeline_worker.py
```

The worker will pick up the queued run and execute it.

## Option 3: Test Individual Steps Without Worker

If you want to test just one step:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
export $(cat .env | grep -v '^#' | xargs)

# Test event processor with your conservative limits
python automation/processors/flash_standalone_event_processor.py \
  --max-workers 3 \
  --cooldown-seconds 90 \
  --job-limit 300

# Test deduplicator with your conservative limits
python automation/scripts/deduplicate_events_with_gemini.py \
  --limit 20 \
  --recent-days 30 \
  --verbose \
  --live \
  --yes \
  --once
```

## Monitoring Test Runs

### Check Database Status

```sql
-- See current automation runs
SELECT id, status, current_step, created_at, started_at, completed_at
FROM automation_runs
ORDER BY created_at DESC
LIMIT 5;

-- See step details for a specific run
SELECT step_states
FROM automation_runs
WHERE id = 'your-run-id';
```

### Check Logs in Real-Time

The worker streams logs to stdout, but they're also saved to the database:

```sql
SELECT step_states->'event_process'->'log_tail'
FROM automation_runs
WHERE id = 'your-run-id';
```

## Expected Behavior with Conservative Test Values

With your current `.env` settings:

| Step | Limit | Expected Duration |
|------|-------|-------------------|
| twitter_scrape | N/A | 5-15 min (depends on queue) |
| instagram_scrape | Skipped | 0 sec (include_instagram=false) |
| post_process | N/A | 2-5 min |
| image_download | 50 media files | 3-8 min |
| event_process | 300 posts, 3 workers | 10-20 min |
| event_dedup | 20 events | 5-10 min |
| twitter_profile_scrape | N/A | 5-15 min |
| instagram_profile_scrape | Skipped | 0 sec |
| coordinate_backfill | N/A | 2-5 min |

**Total expected duration**: ~35-80 minutes for a full run

## Stopping the Worker

The worker handles graceful shutdown:

```bash
# Press Ctrl+C in the worker terminal
# You'll see:
🛑 Received termination signal, stopping worker after current cycle...
👋 Worker stopped
```

If a step is running, it will complete that step before stopping.

## Troubleshooting

### Worker says "No queued runs" but I just created one
- Check the run wasn't picked up already: `SELECT * FROM automation_runs WHERE status='running'`
- Verify database connection is working
- Check the worker is connected to the same database as your API

### Step fails with "module not found"
- Ensure you're running from the correct directory (repo root)
- Set PYTHONPATH: `export PYTHONPATH="${PYTHONPATH}:$(pwd)"`

### API endpoint returns 500 error
- Check `SUPABASE_SERVICE_ROLE_KEY` is set in `.env`
- Verify automation_settings table exists
- Check Vercel dev server logs for errors

### Worker crashes mid-run
- Check the `automation_runs` table - the run will be marked as 'running' with current_step set
- Restart the worker - it will resume from where it left off
- Check logs in step_states for the failed step

## Next Steps After Testing

Once local testing succeeds:

1. **Update Vercel environment variables** with your conservative values (or production values)
2. **Deploy the worker** to a persistent server (Fly, Railway, EC2, etc.)
3. **Verify the Vercel cron** is scheduled correctly
4. **Monitor first production run** via the `/automation` UI page

The automation dashboard at `/automation` shows:
- Current run status with live progress
- Recent run history
- Per-step logs and durations
- Settings to adjust cadence and Instagram toggle
