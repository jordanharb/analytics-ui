# Apply SQL Functions - DO THIS NOW

## ✅ SQL Files Ready to Apply

Both SQL files have been updated with:
- `DROP FUNCTION IF EXISTS` statements at the top to remove old buggy versions
- `CREATE FUNCTION` (not CREATE OR REPLACE) to ensure clean creation
- All column references fixed

## Step 1: Apply SQL Files

### Option A: Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard** → https://supabase.com/dashboard
2. Go to your project → **SQL Editor**
3. Click **New Query**

4. **Apply First File:**
   - Copy ENTIRE contents of `sql/bulk_update_functions.sql`
   - Paste into editor
   - Click **Run** (or Cmd+Enter)
   - Should see: "Success. No rows returned"

5. **Apply Second File:**
   - Click **New Query** again
   - Copy ENTIRE contents of `sql/additional_bulk_functions.sql`
   - Paste into editor
   - Click **Run** (or Cmd+Enter)
   - Should see: "Success. No rows returned"

### Option B: Command Line (Alternative)

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# If you have Supabase CLI configured:
supabase db execute < sql/bulk_update_functions.sql
supabase db execute < sql/additional_bulk_functions.sql
```

## Step 2: Verify Functions Installed

Run this from the repo root:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
python3 << 'PYTHON'
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
from utils.database import get_supabase

supabase = get_supabase()

print("\n🔍 Testing RPC Functions...\n")

# Test bulk_insert_posts
try:
    result = supabase.rpc('bulk_insert_posts', {'posts': '[]'}).execute()
    print("✅ bulk_insert_posts - Working")
except Exception as e:
    if "does not exist" in str(e).lower():
        print(f"❌ bulk_insert_posts - NOT FOUND")
    else:
        print(f"✅ bulk_insert_posts - Exists (got expected error with empty data)")

# Test bulk_update_last_scrape
try:
    result = supabase.rpc('bulk_update_last_scrape', {'actor_ids': []}).execute()
    print(f"✅ bulk_update_last_scrape - Working (updated {result.data} rows)")
except Exception as e:
    print(f"❌ bulk_update_last_scrape - {e}")

# Test merge_duplicate_event
try:
    result = supabase.rpc('merge_duplicate_event', {
        'p_primary_id': '00000000-0000-0000-0000-000000000000',
        'p_duplicate_id': '00000000-0000-0000-0000-000000000001'
    }).execute()
    print(f"✅ merge_duplicate_event - Exists")
except Exception as e:
    if "does not exist" in str(e).lower():
        print(f"❌ merge_duplicate_event - NOT FOUND")
    else:
        print(f"✅ merge_duplicate_event - Exists (got expected error with fake UUIDs)")

print("\n✅ If you see checkmarks, you're ready to test!\n")
PYTHON
```

## Step 3: Restart Pipeline Worker

**IMPORTANT:** The worker caches Python code. You MUST restart it.

In Terminal 1 (where worker is running):
1. Press `Ctrl+C`
2. Wait for "👋 Worker stopped"
3. Restart:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python -u web/analytics-ui/automation/worker/pipeline_worker.py
```

## Step 4: Test

In Terminal 2:
```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python web/analytics-ui/automation/trigger_run.py
```

## Expected Output

Post processor should show:
```
✅ Unknown actors will be checked on-demand (skipping preload)
📝 Inserting 16 posts via RPC (ON CONFLICT on post_id)...
✅ Inserted X new posts, skipped Y duplicates
```

**NOT:**
```
📋 Loading existing unknown actors... (❌ should not see this)
Fetched 80000 rows so far... (❌ should not see this)
column "offline_media_url" does not exist (❌ should not see this)
```

## Troubleshooting

**"Function does not exist" error:**
- SQL files weren't applied correctly
- Re-apply both SQL files from the dashboard

**Still seeing old behavior:**
- Worker wasn't restarted
- Press Ctrl+C and restart the worker

**"Permission denied" on DROP:**
- You're not using service_role key
- Apply from Supabase Dashboard instead

## What Changed

### Fixed in SQL:
- ✅ Removed `offline_media_url` and `offline_image_url` from `bulk_insert_posts()`
- ✅ Added `DROP FUNCTION IF EXISTS` statements to clean old versions
- ✅ Changed to `CREATE FUNCTION` (not CREATE OR REPLACE) for cleaner updates

### Fixed in Python:
- ✅ Disabled loading 113K unknown actors at startup
- ✅ Post processor now checks unknown actors on-demand only
- ✅ All RPC functions have fallback to individual queries if they fail
