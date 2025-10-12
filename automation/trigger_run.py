#!/usr/bin/env python3
"""
Simple script to trigger an automation run by creating a queued entry in the database.
This is useful for local testing without needing the API routes.
"""
import sys
from pathlib import Path

# Add repo + analytics-ui directories to sys.path for shared helpers
CURRENT_FILE = Path(__file__).resolve()
AUTOMATION_DIR = CURRENT_FILE.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

for candidate in (REPO_ROOT, WEB_DIR, ANALYTICS_UI_DIR):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from utils.database import get_supabase

def trigger_run(include_instagram=False):
    """Create a queued automation run in the database."""
    supabase = get_supabase()

    result = supabase.table('automation_runs').insert({
        'status': 'queued',
        'include_instagram': include_instagram,
        'step_states': {}
    }).execute()

    if result.data:
        run = result.data[0]
        print(f"✅ Created automation run: {run['id']}")
        print(f"   Status: {run['status']}")
        print(f"   Instagram: {run['include_instagram']}")
        print(f"   Created: {run['created_at']}")
        print(f"\nThe worker will pick this up automatically.")
        return run
    else:
        print(f"❌ Failed to create run: {result}")
        return None

if __name__ == '__main__':
    # Check for --instagram flag
    include_instagram = '--instagram' in sys.argv

    print(f"Triggering automation run (Instagram: {include_instagram})...\n")
    trigger_run(include_instagram)
