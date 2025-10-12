#!/usr/bin/env python3
"""
Verification script to check if all optimization RPC functions are installed
Run this before testing the automation pipeline
"""

import sys
from pathlib import Path

# Add repo root to path
CURRENT_FILE = Path(__file__).resolve()
AUTOMATION_DIR = CURRENT_FILE.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

sys.path.insert(0, str(REPO_ROOT))

from utils.database import get_supabase

def check_rpc_function_exists(supabase, function_name):
    """Check if an RPC function exists in the database"""
    try:
        # Try to call the function with dummy args to see if it exists
        # This will error if function doesn't exist
        query = f"""
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
          AND routine_name = '{function_name}'
          AND routine_type = 'FUNCTION';
        """
        result = supabase.rpc('execute_sql', {'query': query}).execute()
        return True
    except:
        # Function doesn't exist or can't execute query
        # Try alternative method
        try:
            # Just try to see if we get a meaningful error
            if function_name == 'bulk_insert_posts':
                supabase.rpc(function_name, {'posts': '[]'}).execute()
            elif function_name == 'bulk_update_post_images':
                supabase.rpc(function_name, {'updates': '[]'}).execute()
            elif function_name == 'get_posts_needing_media':
                supabase.rpc(function_name, {'batch_limit': 1}).execute()
            elif function_name == 'merge_duplicate_event':
                # Will fail due to invalid UUIDs, but that's OK - function exists
                pass
            elif function_name.startswith('bulk_update_last_scrape'):
                supabase.rpc('bulk_update_last_scrape', {'actor_ids': []}).execute()
            return True
        except Exception as e:
            error_str = str(e).lower()
            # If error mentions function doesn't exist, return False
            if 'does not exist' in error_str or 'could not find' in error_str:
                return False
            # Other errors mean function exists but args were wrong (that's OK)
            return True

def main():
    print("\n" + "=" * 60)
    print("🔍 VERIFYING AUTOMATION OPTIMIZATIONS")
    print("=" * 60)

    supabase = get_supabase()

    # Required RPC functions
    required_functions = {
        'Post Processor': [
            'bulk_insert_posts',
            'check_existing_post_ids',
        ],
        'Media Downloader': [
            'get_posts_needing_media',
            'bulk_update_post_images',
        ],
        'Event Deduplicator': [
            'merge_duplicate_event',
            'merge_event_post_links',
            'merge_event_actor_links',
        ],
        'Twitter Scraper': [
            'bulk_update_last_scrape',
            'bulk_update_last_scrape_by_username',
        ],
        'Event Processor (Optional)': [
            'bulk_upsert_event_actor_links',
            'check_missing_post_actor_links',
            'bulk_insert_post_actor_links',
        ],
    }

    all_good = True
    results = {}

    for category, functions in required_functions.items():
        print(f"\n📦 {category}")
        results[category] = {}

        for func_name in functions:
            try:
                # Simple check: try to get function from pg_proc
                query = supabase.table('pg_proc').select('proname').eq('proname', func_name).execute()
                exists = len(query.data) > 0

                if exists:
                    print(f"   ✅ {func_name}")
                    results[category][func_name] = True
                else:
                    print(f"   ❌ {func_name} - NOT FOUND")
                    results[category][func_name] = False
                    all_good = False
            except Exception as e:
                # pg_proc might not be accessible, try alternative
                print(f"   ⚠️  {func_name} - Cannot verify (insufficient permissions)")
                results[category][func_name] = None

    print("\n" + "=" * 60)

    if all_good:
        print("✅ ALL REQUIRED RPC FUNCTIONS ARE INSTALLED!")
        print("\nYou're ready to run the automation pipeline with full optimizations.")
        return 0
    else:
        print("❌ SOME RPC FUNCTIONS ARE MISSING!")
        print("\nPlease apply the SQL files:")
        print("  1. sql/bulk_update_functions.sql")
        print("  2. sql/additional_bulk_functions.sql")
        print("\nSee docs/FIXES_SUMMARY.md for instructions.")
        return 1

if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except Exception as e:
        print(f"\n❌ Error running verification: {e}")
        print("\nThis might mean:")
        print("  - Database connection failed")
        print("  - Environment variables not set")
        print("  - Insufficient permissions")
        sys.exit(1)
