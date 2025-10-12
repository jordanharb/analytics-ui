#!/usr/bin/env python3
"""
Run full pipeline: Twitter scrape → Post processor → Event processor (Flash/Pro) → Coordinate backfill

Usage examples:
  python scripts/run_full_pipeline.py                   # default: direct scrape, flash model, cooldown 90s
  python scripts/run_full_pipeline.py --celery          # dispatch scraper via Celery and wait for completion
  python scripts/run_full_pipeline.py --pro             # use Gemini 2.5 Pro for event extraction
  python scripts/run_full_pipeline.py --cooldown 120    # set API worker cooldown seconds

Env prerequisites: SUPABASE_URL, SUPABASE_KEY (and service key for event processor), GOOGLE_MAPS_API_KEY
"""
import os
import sys
import time
import asyncio
import argparse
from datetime import datetime
from pathlib import Path

CURRENT_FILE = Path(__file__).resolve()
SCRIPTS_DIR = CURRENT_FILE.parent
AUTOMATION_DIR = SCRIPTS_DIR.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

for candidate in (REPO_ROOT, WEB_DIR, ANALYTICS_UI_DIR):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)


def _print_banner(title: str):
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)


async def run_twitter_scrape(celery: bool = False) -> bool:
    from run_twitter_scraper import run_twitter_scraper_direct, run_twitter_scraper_celery
    if celery:
        _print_banner("Dispatching Twitter Scraper via Celery")
        job_id = run_twitter_scraper_celery(None)
        if not job_id:
            print("❌ Failed to dispatch Celery job")
            return False
        print(f"📋 Celery job id: {job_id}")
        # Poll v2_batches for completion
        from utils.database import get_supabase
        supa = get_supabase()
        print("⏳ Waiting for Celery job to complete...")
        while True:
            res = supa.table('v2_batches').select('status').eq('id', job_id).limit(1).execute()
            status = (res.data[0]['status'] if res.data else 'unknown')
            print(f"   status: {status}")
            if status in ('completed', 'failed', 'cancelled'):
                return status == 'completed'
            time.sleep(10)
    else:
        _print_banner("Running Twitter Scraper (Direct Mode)")
        ok = await run_twitter_scraper_direct()
        return ok


def run_post_processor() -> int:
    _print_banner("Running Post Processor")
    # Prefer optimized processor
    from processors.post_processor import SocialMediaProcessor
    processor = SocialMediaProcessor()
    processor.process_all_files(migration=False)
    posts_inserted = int(processor.stats.get('posts_inserted', 0) or 0)
    print(f"✅ Post processing complete. Posts inserted: {posts_inserted}")
    return posts_inserted


def run_event_processor_flash(posts_limit: int, use_pro: bool, cooldown: float) -> bool:
    _print_banner(f"Running Event Processor ({'Pro' if use_pro else 'Flash'}) with limit={posts_limit}, cooldown={cooldown}s")
    # The processor reads GOOGLE_API_KEY and Supabase envs; ensure present
    from processors.flash_standalone_event_processor import StandaloneEventProcessor
    job_id = None
    proc = StandaloneEventProcessor(job_id, auto_create=True)
    # Pass cooldown via function arg and also env for safety
    os.environ['API_WORKER_COOLDOWN_SECONDS'] = str(cooldown)
    result = proc.run(job_limit=posts_limit, cooldown_seconds=cooldown, batch_size=None, max_workers=None)
    ok = bool(result.get('success'))
    print(f"✅ Event processor {'succeeded' if ok else 'finished with issues'}")
    return ok


def run_backfill_coordinates() -> bool:
    _print_banner("Backfilling Coordinates")
    # Ensure script path importable
    scripts_dir = os.path.join(REPO_ROOT, 'web', 'analytics-ui', 'scripts')
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    import backfill_coordinates as bc
    ok = bc.backfill_v2_event_coordinates_enhanced(use_cache=True, reset=False)
    print(f"✅ Coordinate backfill {'succeeded' if ok else 'failed'}")
    return bool(ok)


def main():
    parser = argparse.ArgumentParser(description='Run full scrape → process → events → backfill pipeline')
    parser.add_argument('--celery', action='store_true', help='Run Twitter scraper via Celery and wait for completion')
    parser.add_argument('--pro', action='store_true', help='Use Gemini 2.5 Pro for event extraction')
    parser.add_argument('--cooldown', type=float, default=90.0, help='Cooldown between API calls per worker (seconds)')
    args = parser.parse_args()

    started = datetime.now()
    print(f"🚀 Pipeline started at {started.isoformat()}")

    ok = asyncio.run(run_twitter_scrape(celery=args.celery))
    if not ok:
        print("❌ Twitter scraping failed. Aborting.")
        sys.exit(1)

    posts_inserted = run_post_processor()

    if posts_inserted <= 0:
        print("⚠️ No new posts inserted; proceeding to event processor with limit=0 (will likely noop)")

    run_event_processor_flash(max(posts_inserted, 0), use_pro=args.pro, cooldown=args.cooldown)

    run_backfill_coordinates()

    finished = datetime.now()
    print(f"🎉 Pipeline completed at {finished.isoformat()} (duration: {finished - started})")


if __name__ == '__main__':
    main()
