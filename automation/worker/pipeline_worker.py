#!/usr/bin/env python3
"""
Automation pipeline worker
Fetches queued automation_runs from Supabase and executes each step sequentially.
Each step runs the corresponding Python script using the current Python interpreter.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure repo root is in path
CURRENT_FILE = Path(__file__).resolve()
AUTOMATION_DIR = CURRENT_FILE.parent.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent

# Check if we're in a standalone analytics-ui deployment (Vercel) or full repo
# Standalone: analytics-ui IS the root (has utils/ directly)
# Full repo: analytics-ui is nested (web/analytics-ui/)
if (ANALYTICS_UI_DIR / 'utils' / 'database.py').exists():
    # Standalone deployment: analytics-ui IS the root
    REPO_ROOT = ANALYTICS_UI_DIR
    print(f"🚀 Standalone deployment detected (analytics-ui is root)")
else:
    # Full repo: analytics-ui is nested
    WEB_DIR = ANALYTICS_UI_DIR.parent
    REPO_ROOT = WEB_DIR.parent
    print(f"📁 Full repo deployment detected")

print(f"DEBUG: REPO_ROOT = {REPO_ROOT}")
print(f"DEBUG: ANALYTICS_UI_DIR = {ANALYTICS_UI_DIR}")
print(f"DEBUG: AUTOMATION_DIR = {AUTOMATION_DIR}")

for candidate in (REPO_ROOT, ANALYTICS_UI_DIR, AUTOMATION_DIR):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from utils.database import get_supabase  # noqa: E402

POLL_SECONDS = int(os.getenv('AUTOMATION_WORKER_POLL_SECONDS', '60'))
LOG_LINE_LIMIT = int(os.getenv('AUTOMATION_WORKER_LOG_LINES', '200'))


def _get_event_posts_limit() -> int:
    """Get event posts limit from database settings (with fallback to env)."""
    try:
        from automation.utils.settings import get_event_posts_limit
        return get_event_posts_limit()
    except Exception as e:
        print(f"⚠️  Could not fetch event_posts_limit from database: {e}")
        return int(os.getenv('AUTOMATION_EVENT_POSTS_LIMIT', '300'))


def _get_dedup_events_limit() -> int:
    """Get dedup events limit from database settings (with fallback to env)."""
    try:
        from automation.utils.settings import get_dedup_events_limit
        return get_dedup_events_limit()
    except Exception as e:
        print(f"⚠️  Could not fetch dedup_events_limit from database: {e}")
        return int(os.getenv('AUTOMATION_DEDUP_EVENTS_LIMIT', '20'))


@dataclass
class PipelineStep:
    name: str
    command: List[str]
    optional_flag: Optional[str] = None  # Attribute on run config to decide skipping
    env: Optional[Dict[str, str]] = None


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_settings_id(supabase) -> Optional[str]:
    try:
        response = supabase.table('automation_settings').select('id').order('created_at').limit(1).execute()
        rows = response.data or []
        if not rows:
            return None
        return rows[0]['id']
    except Exception as e:
        print(f"⚠️ Failed to load automation settings id: {e}")
        return None


def fetch_next_run(supabase) -> Optional[Dict[str, Any]]:
    try:
        response = supabase.table('automation_runs') \
            .select('*') \
            .in_('status', ['queued', 'running']) \
            .order('created_at') \
            .limit(1) \
            .execute()
        runs = response.data or []
        return runs[0] if runs else None
    except Exception as e:
        print(f"⚠️ Failed to fetch automation run: {e}")
        return None


def update_run(supabase, run_id: str, fields: Dict[str, Any]) -> bool:
    try:
        supabase.table('automation_runs').update(fields).eq('id', run_id).execute()
        return True
    except Exception as e:
        print(f"⚠️ Failed to update run {run_id}: {e}")
        return False


def update_settings(supabase, settings_id: Optional[str], fields: Dict[str, Any]):
    if not settings_id:
        return
    try:
        supabase.table('automation_settings').update(fields).eq('id', settings_id).execute()
    except Exception as e:
        print(f"⚠️ Failed to update automation settings: {e}")


def append_log_tail(log_lines: List[str]) -> List[str]:
    if len(log_lines) <= LOG_LINE_LIMIT:
        return log_lines
    return log_lines[-LOG_LINE_LIMIT:]


def run_step(step: PipelineStep, run_config: Dict[str, Any]) -> Dict[str, Any]:
    command = step.command
    env = os.environ.copy()

    # Ensure PYTHONPATH includes repo root so scripts can import utils
    pythonpath = env.get('PYTHONPATH', '')
    repo_root_str = str(REPO_ROOT)
    if repo_root_str not in pythonpath:
        env['PYTHONPATH'] = f"{repo_root_str}:{pythonpath}" if pythonpath else repo_root_str

    if step.env:
        env.update(step.env)

    print(f"\n➡️  Starting step: {step.name}")
    print(f"    Command: {' '.join(command)}")
    print(f"    PYTHONPATH: {env.get('PYTHONPATH', 'NOT SET')}")
    print(f"    CWD: {REPO_ROOT}")

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(REPO_ROOT),
        env=env
    )

    log_lines: List[str] = []
    try:
        assert process.stdout is not None
        for line in process.stdout:
            print(f"[{step.name}] {line}", end='')
            log_lines.append(line.rstrip())
    except Exception as stream_error:  # pragma: no cover
        print(f"⚠️  Failed reading stdout for {step.name}: {stream_error}")

    return_code = process.wait()
    status = 'completed' if return_code == 0 else 'failed'
    print(f"⬅️  Step {step.name} finished with status {status} (code {return_code})")

    return {
        'status': status,
        'return_code': return_code,
        'log_tail': append_log_tail(log_lines)
    }


PIPELINE_STEPS: List[PipelineStep] = [
    PipelineStep(
        name='twitter_scrape',
        command=[sys.executable, str(AUTOMATION_DIR / 'scrapers' / 'twitter_scraper.py')]
    ),
    PipelineStep(
        name='instagram_scrape',
        command=[sys.executable, str(AUTOMATION_DIR / 'scrapers' / 'instagram_post_scraper.py')],
        optional_flag='include_instagram'
    ),
    PipelineStep(
        name='post_process',
        command=[sys.executable, str(AUTOMATION_DIR / 'processors' / 'post_processor.py')]
    ),
    PipelineStep(
        name='image_download',
        command=[
            sys.executable,
            str(AUTOMATION_DIR / 'processors' / 'instagram_media_downloader_optimized.py'),
            '--batch-size', os.getenv('AUTOMATION_MEDIA_BATCH_SIZE', '200')
        ]
    ),
    PipelineStep(
        name='event_process',
        command=[
            sys.executable,
            str(AUTOMATION_DIR / 'processors' / 'flash_standalone_event_processor.py'),
            '--max-workers', os.getenv('AUTOMATION_EVENT_MAX_WORKERS', '6'),
            '--cooldown-seconds', os.getenv('AUTOMATION_WORKER_COOLDOWN', '60'),
            '--job-limit', str(_get_event_posts_limit())
        ]
    ),
    PipelineStep(
        name='event_dedup',
        command=[
            sys.executable,
            str(AUTOMATION_DIR / 'scripts' / 'deduplicate_events_with_gemini.py'),
            '--live', '--yes', '--once',
            '--sleep-seconds', os.getenv('AUTOMATION_DEDUP_SLEEP_SECONDS', '120'),
            '--limit', str(_get_dedup_events_limit())
        ]
    ),
    PipelineStep(
        name='twitter_profile_scrape',
        command=[sys.executable, str(AUTOMATION_DIR / 'scrapers' / 'profile_scraper.py')]
    ),
    PipelineStep(
        name='instagram_profile_scrape',
        command=[sys.executable, str(AUTOMATION_DIR / 'scrapers' / 'instagram_profile_scraper.py')],
        optional_flag='include_instagram'
    ),
    PipelineStep(
        name='coordinate_backfill',
        command=[sys.executable, str(AUTOMATION_DIR / 'scripts' / 'backfill_coordinates_simple.py')]
    )
]


def process_run(supabase, run: Dict[str, Any], settings_id: Optional[str]):
    run_id = run['id']
    include_instagram = run.get('include_instagram', False)
    step_states = run.get('step_states') or {}
    status = run.get('status')

    if status == 'queued':
        print(f"🏁 Starting automation run {run_id}")
        update_run(supabase, run_id, {
            'status': 'running',
            'started_at': iso_now()
        })
        update_settings(supabase, settings_id, {'last_run_started_at': iso_now()})
        step_states = {}
    else:
        print(f"🔁 Resuming automation run {run_id} (status: {status})")

    for step in PIPELINE_STEPS:
        step_state = step_states.get(step.name) or {}
        if step_state.get('status') == 'completed':
            continue
        if step.optional_flag == 'include_instagram' and not include_instagram:
            print(f"⏭️  Skipping {step.name} (Instagram disabled)")
            step_states[step.name] = {
                'status': 'skipped',
                'updated_at': iso_now()
            }
            update_run(supabase, run_id, {
                'step_states': step_states,
                'current_step': step.name
            })
            continue

        started_iso = iso_now()
        step_states = {
            **step_states,
            step.name: {
                **step_state,
                'status': 'running',
                'started_at': started_iso
            }
        }
        update_run(supabase, run_id, {
            'current_step': step.name,
            'step_states': step_states,
            'error_message': None
        })

        started_at = datetime.now(timezone.utc)
        result = run_step(step, run)
        finished_at = datetime.now(timezone.utc)
        duration = (finished_at - started_at).total_seconds()

        step_states[step.name] = {
            'status': result['status'],
            'started_at': step_states[step.name].get('started_at'),
            'completed_at': finished_at.isoformat(),
            'duration_seconds': duration,
            'log_tail': result['log_tail'],
            'return_code': result['return_code']
        }

        update_run(supabase, run_id, {
            'step_states': step_states,
            'current_step': step.name,
            'error_message': None if result['status'] == 'completed' else f"Step {step.name} failed"
        })

        if result['status'] != 'completed':
            print(f"❌ Run {run_id} failed at step {step.name}")
            update_run(supabase, run_id, {
                'status': 'failed',
                'completed_at': iso_now()
            })
            return

    print(f"✅ Automation run {run_id} completed successfully")
    update_run(supabase, run_id, {
        'status': 'succeeded',
        'completed_at': iso_now(),
        'current_step': None
    })
    update_settings(supabase, settings_id, {'last_run_completed_at': iso_now()})


def main():
    supabase = get_supabase()
    settings_id = load_settings_id(supabase)

    stop_requested = False

    def handle_sigterm(signum, frame):  # noqa: ANN001, ANN202
        nonlocal stop_requested
        print("\n🛑 Received termination signal, stopping worker after current cycle...")
        stop_requested = True

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    while not stop_requested:
        run = fetch_next_run(supabase)
        if run:
            process_run(supabase, run, settings_id)
        else:
            print(f"⌛ No queued runs. Sleeping for {POLL_SECONDS} seconds...")
            time.sleep(POLL_SECONDS)

    print("👋 Worker stopped")


if __name__ == '__main__':
    main()
