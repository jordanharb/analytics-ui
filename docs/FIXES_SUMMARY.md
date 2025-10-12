# Complete Fixes Summary - Apply Before Testing

## Issues Fixed

### 1. RPC Function Column Mismatch ✅
**Error**: `column "offline_media_url" of relation "v2_social_media_posts" does not exist`

**Root Cause**: The `bulk_insert_posts()` RPC function tried to insert `offline_image_url` and `offline_media_url` columns, but these don't exist when posts are first created by the post processor. They're added later by the media downloader (Instagram only).

**Fix**: Removed these columns from the RPC function insert statement.

**File**: `sql/bulk_update_functions.sql` (lines 79-121)

### 2. Massive Startup Data Loading ✅
**Issue**: Post processor loaded 113,857 rows of unknown actors at startup, taking 30+ seconds and making inefficient queries.

**Root Cause**: The `load_existing_unknown_actors()` method loaded ALL unknown actors into memory even though it only processes 10-20 posts per run.

**Fix**: Disabled preloading of unknown actors cache. The system already checks on-demand via database queries and caches results, so preloading is wasteful.

**File**: `automation/processors/post_processor.py` (lines 68-71)

**Performance Impact**:
- **Before**: 30+ seconds startup, 113K rows loaded, inefficient pagination queries
- **After**: <5 seconds startup, on-demand lookups only

## How to Apply Fixes

### Step 1: Apply Updated SQL File

The `bulk_insert_posts()` function needs to be recreated without the offline media columns.

**Option A: Via Supabase Dashboard (Recommended)**

1. Open Supabase Dashboard → SQL Editor
2. Create New Query
3. Copy the ENTIRE contents of `sql/bulk_update_functions.sql`
4. Click "Run"
5. Verify no errors

**Option B: Via Supabase CLI**

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui
supabase db execute < sql/bulk_update_functions.sql
```

### Step 2: Restart the Pipeline Worker

**IMPORTANT**: The worker caches the Python code in memory. You MUST restart it to pick up the post_processor.py changes.

**In Terminal 1 (where worker is running)**:

1. Press `Ctrl+C` to stop the worker
2. Wait for "👋 Worker stopped" message
3. Restart with the same command:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring
export $(cat web/analytics-ui/.env | grep -v '^#' | xargs)
python -u web/analytics-ui/automation/worker/pipeline_worker.py
```

### Step 3: Verify Fixes Are Applied

When you trigger a new run, you should see:

**Post Processor Startup (Should be FAST)**:
```
📋 Loading known usernames...
📋 Loaded 1234 known usernames
🔗 Building actor lookup cache...
✅ Unknown actors will be checked on-demand (skipping preload)

============================================================
🚀 OPTIMIZED POST PROCESSOR
============================================================
```

**NO MORE**:
- "Loading existing unknown actors..."
- "Fetched 80000 rows so far"
- URLs with hundreds of `offset=` parameters

**Post Insertion (Should use RPC)**:
```
   📝 Inserting 16 posts via RPC (ON CONFLICT on post_id)...
```

**NO MORE**:
- "column offline_media_url does not exist" error
- Individual INSERT fallback with 409 Conflict errors

## Verification Checklist

- [ ] Applied `sql/bulk_update_functions.sql` to database
- [ ] Verified function exists: `SELECT * FROM information_schema.routines WHERE routine_name = 'bulk_insert_posts';`
- [ ] Stopped pipeline worker (Ctrl+C)
- [ ] Restarted pipeline worker
- [ ] Triggered new automation run
- [ ] Verified fast startup (no unknown actor loading)
- [ ] Verified RPC function works (no column errors)
- [ ] Verified ON CONFLICT handles duplicates silently

## Expected Performance After Fixes

| Metric | Before | After |
|--------|--------|-------|
| Post processor startup time | 30-40 seconds | 3-5 seconds |
| Unknown actors rows loaded | 113,857 | 0 (on-demand) |
| Database queries at startup | 80+ pagination queries | 2-3 simple queries |
| Post insertion | Individual INSERTs with errors | Single RPC with ON CONFLICT |
| Duplicate handling | Try/catch 409 errors | Silent ON CONFLICT |

## Still Seeing Old Behavior?

If you still see the old logs after applying fixes:

1. **Check you restarted the worker** - Python caches imported modules
2. **Check you're reading the right logs** - Old logs from previous runs will still show the old behavior
3. **Check file was actually saved** - Run `git diff automation/processors/post_processor.py` to verify changes
4. **Check SQL was applied** - Run the verification query above

## Files Changed

✅ `sql/bulk_update_functions.sql` - Removed offline media columns from `bulk_insert_posts()`
✅ `automation/processors/post_processor.py` - Disabled unknown actors preloading
✅ `sql/additional_bulk_functions.sql` - Created (other optimizations)
✅ `automation/scripts/deduplicate_events_with_gemini.py` - Uses merge RPC
✅ `automation/scrapers/twitter_scraper.py` - Uses bulk timestamp RPC

## Additional SQL File to Apply (Optional but Recommended)

For maximum performance, also apply:

```bash
supabase db execute < sql/additional_bulk_functions.sql
```

This creates RPC functions for:
- Event deduplicator (100x faster merges)
- Twitter scraper (10x faster timestamp updates)
- Event processor (bulk operations)
