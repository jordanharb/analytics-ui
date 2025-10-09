# Automation Pipeline Setup

This guide explains how to run the new multi-step automation pipeline for the Woke Palantir analytics UI. The pipeline mirrors the original workflow (Twitter → Instagram → Post Processor → Image Downloader → Flash Event Processor → Event Deduplication → Coordinate Backfill) and is split across three parts:

1. **Python workers** copied into `automation/` that execute the underlying scripts.
2. **Supabase tables + stored procedure** used for configuration, scheduling, and run telemetry.
3. **Vercel API routes + React dashboard** that manage settings, trigger runs, and expose status in the UI.

## 1. Database Schema

Run `sql/automation_schema.sql` against the Supabase project. It creates:

- `automation_settings` – singleton row tracking cadence, Instagram toggle, and the next scheduled run.
- `automation_runs` – log of every pipeline execution with per-step metadata.
- `schedule_automation_run()` – helper to atomically queue the next run (used by cron/worker).

## 2. Environment Variables

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase URL (service role client is required server-side). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used by the Vercel API routes. **Never expose** to the browser. |
| `AUTOMATION_CRON_SECRET` | Optional bearer token that protects `/api/automation/advance`. Set both in Vercel and the cron job. |
| `AUTOMATION_MEDIA_BATCH_SIZE` | Batch size for the Instagram media downloader step (default `200`). |
| `AUTOMATION_EVENT_MAX_WORKERS` | Override worker count for the Gemini Flash event processor (default `6`). |
| `AUTOMATION_WORKER_COOLDOWN` | Seconds between Gemini calls per worker (default `60`). |
| `AUTOMATION_DEDUP_SLEEP_SECONDS` | Fallback sleep window for dedup script (default `120`). |
| `AUTOMATION_WORKER_POLL_SECONDS` | Poll interval for the Python worker to look for new runs (default `60`). |
| `GEMINI_DEDUP_API_KEY` | Dedicated Gemini key for the deduplication script (falls back to `GOOGLE_API_KEY`). |
| `GOOGLE_AI_API_KEY_1..6` | Up to six Gemini API keys for the Flash event processor. |
| `SCRAPFLY_KEY` | Required for the Instagram post scraper. |

The copied python scripts still expect the original `.env` variables (Supabase, Google Maps, storage buckets, etc.). Ensure those are present in the worker runtime.

## 3. Vercel API Routes

Routes live inside `api/automation/`:

- `config.ts` – read/update automation settings.
- `run.ts` – queue a manual run.
- `runs.ts` – fetch run history (with optional `?id=` lookup).
- `advance.ts` – secure endpoint that calls `schedule_automation_run()` (used for Vercel cron).

Add Vercel cron (or any scheduler) to `POST https://<deployment>/api/automation/advance` every 2 days. Include `Authorization: Bearer $AUTOMATION_CRON_SECRET` when the secret is set.

## 4. Python Worker

`automation/worker/pipeline_worker.py` polls Supabase for queued runs, executes each step, and streams stdout back to the database. Steps are defined in `PIPELINE_STEPS` and call the freshly copied scripts:

```
python automation/worker/pipeline_worker.py
```

The worker is designed to run on a persistent VM (Fly, Railway, EC2, etc.). It resumes partial runs, writes `step_states` into Supabase, and respects SIGINT/SIGTERM for graceful shutdown.

Each run executes exactly one step at a time. The worker updates `automation_runs.step_states` after every transition so the UI can reflect progress live and you can resume from a partially completed run if the worker restarts.

## 5. Pipeline Step Catalog

The pipeline currently executes the following steps in order. Optional steps respect the `include_instagram` flag that you toggle in the Automation UI.

| Step key | Script | Purpose | Key inputs/outputs |
| --- | --- | --- | --- |
| `twitter_scrape` | `automation/scrapers/twitter_scraper.py` | Pulls queued Twitter handles from the Scraping Manager tables, downloads recent tweets with media, and uploads JSON to Supabase storage. | Reads `actor_usernames` / scraping queue rows, writes raw tweets to storage + status rows. |
| `instagram_scrape` *(optional)* | `automation/scrapers/instagram_post_scraper.py` | Uses Scrapfly to fetch recent Instagram posts for queued handles. Skipped when Instagram automation is disabled. | Reads Instagram scraping queue, writes post JSON + media metadata. |
| `post_process` | `automation/processors/post_processor.py` | Normalizes raw post payloads, creates `v2_social_media_posts`, enqueues media download tasks, and queues events for extraction. | Consumes storage objects produced by scrapers, populates `v2_social_media_posts`, and updates job tables. |
| `image_download` | `automation/processors/instagram_media_downloader_optimized.py` | Downloads referenced Instagram media to persistent storage for UI usage. Controlled by `AUTOMATION_MEDIA_BATCH_SIZE`. | Reads `v2_social_media_posts` media URLs, writes media assets to storage. |
| `event_process` | `automation/processors/flash_standalone_event_processor.py` | Runs the Gemini Flash event extractor on newly ingested posts to produce structured `v2_events` with linked post/event metadata. Concurrency tuned via `AUTOMATION_EVENT_MAX_WORKERS`. | Reads unprocessed posts, writes `v2_events`, `v2_event_post_links`, and `v2_event_actor_links`. |
| `event_dedup` | `automation/scripts/deduplicate_events_with_gemini.py` | Uses Gemini to detect duplicate events and merges them. Sleep window controlled by `AUTOMATION_DEDUP_SLEEP_SECONDS`. | Reads recent events, merges duplicates, updates `v2_event_denorm`.
| `twitter_profile_scrape` | `scrapers/profile_scraper.py` | Scrapes Twitter profiles for both unknown actors and known actors lacking fresh metadata. Prioritizes mention-heavy unknown actors discovered earlier steps. | Reads `unknown_actors`, `v2_actor_usernames`, writes enriched `x_profile_data`, `about`, and timestamp fields. |
| `instagram_profile_scrape` *(optional)* | `scrapers/instagram_profile_scraper.py` | Scrapes Instagram bios for unknown actors and active handles via Scrapfly. Respects include-instagram toggle and skips accounts recently processed or with persistent errors. | Reads unknown + known Instagram handles, writes `instagram_profile_data`, `last_profile_update`. |
| `coordinate_backfill` | `automation/scripts/backfill_coordinates.py` | Fills missing lat/lon for events and actor locations to keep map experiences accurate. | Reads `v2_events`, `v2_actors`, updates coordinate columns.

The Automation dashboard surfaces these step keys directly, so any additions appear without UI changes. If you add future steps, extend `PIPELINE_STEPS` and document them here for clarity.

## 6. React Dashboard

`/automation` route (added to the header) provides:

- Toggles for enabling automation and Instagram scraping.
- Editable run interval (default 48 hours) and scheduling metadata.
- "Run Pipeline Now" button for manual execution.
- Current run progress with per-step status badges.
- Recent run history with badges, durations, and truncated logs.

The automation service is implemented in `src/api/automationService.ts` and wraps the API endpoints.

## 7. Scheduling With Vercel Cron

Vercel only needs to trigger the loop; the worker handles sequencing. Recommended setup:

1. **Cron schedule** – Add an entry in `vercel.json` (example below) that hits the secure advance endpoint every hour. The endpoint inspects `automation_settings.run_interval_hours`, `is_enabled`, and `next_run_at` to decide whether to queue a run, so you can safely call it more frequently than the desired cadence.

   ```json
   {
     "crons": [
       {
         "path": "/api/automation/advance",
         "schedule": "0 * * * *",
         "timezone": "America/Phoenix",
         "method": "POST",
         "headers": {
           "authorization": "Bearer ${AUTOMATION_CRON_SECRET}"
         }
       }
     ]
   }
   ```

2. **Automation cadence** – Use the Automation page to set `run_interval_hours` (default 48 for "every two days"). The advance endpoint checks this value before inserting a new `automation_runs` row, guaranteeing that the full step-by-step run only fires when due.

3. **Execution flow** – When a run is queued, the worker picks it up, executes each step sequentially, and records per-step logs. If the worker is offline, the queued run remains pending until it reconnects.

4. **Manual overrides** – Click "Run Pipeline Now" (or call `/api/automation/run`) to push a run immediately—useful after changing settings or during incident response.

5. **Verifying the cron** – Check the Vercel Project → Deployments → Functions logs for `/api/automation/advance`, and monitor the Automation UI to confirm runs queue at the expected cadence.

If you prefer a different scheduler, hit the same endpoint with a POST request containing an optional bearer token. The worker logic is identical.

## 8. Deployment Notes

- The new automation scripts depend on modules in the original repository (`utils/`, `config/`, etc.). Deploy workers from the repository root so Python imports resolve.
- If deploying the worker separately, install the same Python dependencies specified in the root project (use the existing `requirements.txt` / poetry config).
- Ensure Vercel serverless functions have access to `SUPABASE_SERVICE_ROLE_KEY` via encrypted environment variables; the React app only reads public fields returned by the API.
- Consider enabling Supabase Row-Level Security policies for insert/update once role separation is needed. Currently the service-role client performs privileged updates.

With those pieces in place, the automation pipeline can be scheduled, monitored, and manually triggered from the new Woke Palantir UI.
