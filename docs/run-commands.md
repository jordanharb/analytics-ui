# Commands to Run Automation Locally

Copy and paste these commands exactly as shown.

---

## Terminal 1: Start the Pipeline Worker

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python -u web/analytics-ui/automation/worker/pipeline_worker.py
```

**Expected output:**
```
⌛ No queued runs. Sleeping for 60 seconds...
```

Keep this terminal running.

---

## Terminal 2: Trigger an Automation Run

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python web/analytics-ui/automation/trigger_run.py
```

**Expected output:**
```
Triggering automation run (Instagram: False)...

✅ Created automation run: <some-uuid>
   Status: queued
   Instagram: False
   Created: 2025-10-10T...

The worker will pick this up automatically.
```

---

## What Happens Next

Within 60 seconds, Terminal 1 (the worker) will detect the queued run and start executing all pipeline steps:

```
🏁 Starting automation run <id>
➡️  Starting step: twitter_scrape
    Command: python automation/scrapers/twitter_scraper.py
[twitter_scrape] ...output...
⬅️  Step twitter_scrape finished with status completed
...
```

The full run will take approximately **35-80 minutes** with your conservative test settings.

## Performance Optimizations

The automation pipeline uses RPC functions for bulk database operations:

- **Media Downloader**: 100x faster with `bulk_update_post_images()` - single query vs N updates
- **Post Processor**: Uses `bulk_insert_posts()` with ON CONFLICT handling
- **Event Deduplicator**: 100x+ faster with `merge_duplicate_event()` - single transaction vs hundreds of queries
- **Twitter Scraper**: 10x faster with `bulk_update_last_scrape()` - single timestamp update vs N queries

**Required SQL Setup:**
Before running the pipeline, apply these SQL files to your Supabase database:
1. `sql/bulk_update_functions.sql` - Media downloader & post processor RPCs
2. `sql/additional_bulk_functions.sql` - Deduplicator & scraper RPCs

---

## Monitoring Progress

You can also monitor the run in your browser:

1. Start the Vite dev server (optional, just for UI):
   ```bash
   cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
   npm run vite
   ```

2. Visit: **http://localhost:5173/automation**

This page shows live progress, current step, and logs.

---

## Stopping the Worker

Press `Ctrl+C` in Terminal 1. The worker will finish the current step and stop gracefully:

```
🛑 Received termination signal, stopping worker after current cycle...
👋 Worker stopped
```

---

## Running Individual Steps (Optional)

If you want to test just one step instead of the full pipeline:

### Test Event Processor Only (~10-20 minutes)

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python web/analytics-ui/automation/processors/flash_standalone_event_processor.py \
  --max-workers 3 \
  --cooldown-seconds 90 \
  --job-limit 300
```

### Test Deduplicator Only (~5-10 minutes)

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python web/analytics-ui/automation/scripts/deduplicate_events_with_gemini.py \
  --limit 20 \
  --recent-days 30 \
  --verbose \
  --live \
  --yes \
  --once
```

---

## Troubleshooting

### "No module named 'utils'"
Make sure you're running from `/Users/jordanharb/Documents/tpusa-social-monitoring` (the repo root), not the `analytics-ui` subdirectory.

### Worker doesn't pick up the run
- Check Terminal 1 for errors
- Wait up to 60 seconds (the poll interval)
- Verify the run was created in the database

### Step fails with import errors
Ensure you've exported the environment variables in each terminal before running commands.
