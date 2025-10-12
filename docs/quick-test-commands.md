# Quick Test Commands - Run Automation Locally

All processes run on your local machine. You'll need 3 terminal windows.

## Terminal 1: Start the Pipeline Worker

```bash
# Navigate to the analytics UI directory
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Start the worker (will poll for queued runs)
python automation/worker/pipeline_worker.py
```

**Expected output:**
```
⌛ No queued runs. Sleeping for 60 seconds...
```

Keep this terminal running - it's waiting for work to do.

---

## Terminal 2: Start the Dev Server (for API routes)

```bash
# Navigate to the analytics UI directory
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Start Vite dev server + Vercel functions
npm run dev
```

**Expected output:**
```
VITE v7.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
➜  Network: use --host to expose

Vercel functions running on http://localhost:3000
```

Keep this terminal running.

---

## Terminal 3: Trigger the Automation Run

```bash
# Trigger a new automation run (without Instagram)
curl -X POST http://localhost:3000/api/automation/run \
  -H "Content-Type: application/json" \
  -d '{"include_instagram": false}'
```

**Expected response:**
```json
{
  "success": true,
  "run": {
    "id": "some-uuid",
    "status": "queued",
    "include_instagram": false,
    "created_at": "2025-10-10T..."
  }
}
```

---

## What Happens Next

1. **Terminal 1 (worker)** will detect the queued run and start processing:
   ```
   🏁 Starting automation run <id>
   ➡️  Starting step: twitter_scrape
       Command: python automation/scrapers/twitter_scraper.py
   [twitter_scrape] <script output>
   ⬅️  Step twitter_scrape finished with status completed

   ➡️  Starting step: instagram_scrape
   ⏭️  Skipping instagram_scrape (Instagram disabled)

   ➡️  Starting step: post_process
   ...
   ```

2. The worker will execute each step sequentially (takes 35-80 minutes total)

3. You can monitor progress in Terminal 1 or view it in the UI at http://localhost:5173/automation

---

## Stopping Everything

**To stop gracefully:**

- **Terminal 1 (worker)**: Press `Ctrl+C` once - it will finish the current step and stop
- **Terminal 2 (dev server)**: Press `Ctrl+C` to stop the dev server
- **Terminal 3**: No process running, just used for curl command

**If worker is taking too long:**

Press `Ctrl+C` in Terminal 1. The run will be marked as incomplete but you can resume it later by restarting the worker.

---

## Alternative: Run Just One Step

If you want to test a single step without the full pipeline:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
export $(cat .env | grep -v '^#' | xargs)

# Test event processor only (10-20 min)
python automation/processors/flash_standalone_event_processor.py \
  --max-workers 3 \
  --cooldown-seconds 90 \
  --job-limit 300

# OR test deduplicator only (5-10 min)
python automation/scripts/deduplicate_events_with_gemini.py \
  --limit 20 \
  --recent-days 30 \
  --verbose \
  --live \
  --yes \
  --once
```

---

## Monitoring in the UI

While the worker runs, you can view progress at:

**http://localhost:5173/automation**

This page shows:
- Current run status
- Which step is currently running
- Progress indicators
- Recent run history
- Logs from each step

---

## Troubleshooting

### "No module named 'utils'"
You need to be in the parent directory:
```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
python web/analytics-ui/automation/worker/pipeline_worker.py
```

### "Connection refused" on curl command
Make sure Terminal 2 (dev server) is running and shows Vercel functions on port 3000.

### Worker doesn't pick up the run
- Check Terminal 1 for errors
- Verify database connection works
- Check the run was created: visit http://localhost:5173/automation

### API returns 500 error
- Check `SUPABASE_SERVICE_ROLE_KEY` is in your `.env`
- Verify the `automation_settings` table exists in your database
