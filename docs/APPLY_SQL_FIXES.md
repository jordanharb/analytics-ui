# Apply SQL Fixes for Automation Pipeline

## ⚠️ IMPORTANT: Run These SQL Files Before Testing

The automation pipeline optimizations require RPC functions to be installed in your Supabase database.

## Files to Apply

Apply these SQL files in the Supabase SQL Editor (in order):

### 1. Media Downloader & Post Processor RPCs
**File**: `sql/bulk_update_functions.sql`

This creates:
- `get_posts_needing_media(batch_limit)` - Efficient media download queries
- `bulk_update_post_images(updates_jsonb)` - Bulk image URL updates
- `bulk_insert_posts(posts_jsonb)` - Post insertion with ON CONFLICT handling

### 2. Event Deduplicator, Twitter Scraper, & Event Processor RPCs
**File**: `sql/additional_bulk_functions.sql`

This creates:
- `merge_duplicate_event(primary_id, duplicate_id)` - Complete event merge
- `merge_event_post_links(primary_id, duplicate_id)` - Post link migration
- `merge_event_actor_links(primary_id, duplicate_id)` - Actor link migration
- `bulk_update_last_scrape(actor_ids[], timestamp)` - Twitter timestamp updates
- Event processor functions (currently not used but available)

## How to Apply

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Click on "SQL Editor" in the left sidebar
3. Click "New Query"
4. Copy the entire contents of `sql/bulk_update_functions.sql`
5. Paste into the editor
6. Click "Run"
7. Repeat steps 3-6 for `sql/additional_bulk_functions.sql`

### Option 2: Supabase CLI

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Apply first file
supabase db execute < sql/bulk_update_functions.sql

# Apply second file
supabase db execute < sql/additional_bulk_functions.sql
```

## Verification

After applying, verify the functions exist:

```sql
-- Check if functions were created
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%bulk%'
   OR routine_name LIKE '%merge%';
```

You should see:
- `bulk_insert_posts`
- `bulk_update_post_images`
- `get_posts_needing_media`
- `merge_duplicate_event`
- `merge_event_post_links`
- `merge_event_actor_links`
- `bulk_update_last_scrape`
- `bulk_update_last_scrape_by_username`
- And several event processor functions

## Troubleshooting

### Error: "column offline_media_url does not exist"

If you see this error, your database doesn't have the `offline_media_url` column. The SQL file has been updated to exclude this column. Re-apply `sql/bulk_update_functions.sql`.

### Error: "function does not exist"

This means the SQL files haven't been applied yet. Follow the steps above to apply them.

### Permission Errors

The functions are granted to `authenticated` and `service_role` roles. If you're using a different role, you'll need to grant execute permissions manually:

```sql
GRANT EXECUTE ON FUNCTION function_name TO your_role;
```

## What Happens Without These Functions?

If the RPC functions don't exist, the scripts will:
1. Try to call the RPC function
2. Get an error
3. Fall back to the old individual query method
4. Run much slower (10-100x slower)

So the pipeline will still work, but performance will be significantly degraded.
