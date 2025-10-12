# Automation Pipeline Optimizations

This document describes the database optimizations implemented to improve automation pipeline performance.

## Overview

All automation scripts have been optimized to use RPC functions for bulk database operations instead of individual queries in loops. This provides **10-100x performance improvements** across the pipeline.

## SQL Setup Required

Before running the automation pipeline, apply these SQL files to your Supabase database:

1. **sql/bulk_update_functions.sql** - RPC functions for media downloader and post processor
2. **sql/additional_bulk_functions.sql** - RPC functions for event deduplicator, twitter scraper, and event processor

You can apply them via the Supabase SQL editor or using the Supabase CLI:

```bash
# Using Supabase CLI
supabase db push

# Or manually in SQL editor
# Copy and paste the contents of each file into the SQL editor and run
```

## Optimization Details

### 1. Instagram Media Downloader (~100x faster)

**File**: `automation/processors/instagram_media_downloader_optimized.py`

**Before**:
- Fetched full post records with pagination (unnecessary data transfer)
- Individual UPDATE query for each post's `offline_image_url`
- Re-downloaded posts marked as EXPIRED

**After**:
- `get_posts_needing_media(batch_limit)` - Returns only essential fields (post_id, media_url)
- `bulk_update_post_images(updates_jsonb)` - Single UPDATE query for all posts
- Excludes EXPIRED and PERMANENTLY_EXPIRED posts

**Performance**:
- Before: 200 posts × 2 queries each = 400 queries
- After: 2 queries total (1 fetch + 1 bulk update)
- **Improvement: 200x fewer queries**

### 2. Post Processor (eliminates duplicate checking overhead)

**File**: `automation/processors/post_processor.py`

**Before**:
- Pre-checked for duplicate post_ids in application code
- Individual INSERT queries with error suppression
- Post-actor links created with try/catch for duplicates

**After**:
- `bulk_insert_posts(posts_jsonb)` - Handles duplicates via ON CONFLICT on post_id column
- Returns which posts were inserted vs duplicates
- Post-actor links use `.upsert()` with ON CONFLICT handling

**Performance**:
- Before: N queries to check duplicates + M INSERT queries
- After: 1 RPC call with ON CONFLICT handling
- **Improvement: Eliminates overhead of duplicate checking**

### 3. Event Deduplicator (~100x faster per merge)

**File**: `automation/scripts/deduplicate_events_with_gemini.py`

**Before**:
- Loop through all post links checking if each exists on primary event (N queries)
- Individual UPDATE or DELETE for each link (N queries)
- Loop through all actor links checking duplicates (M queries)
- Individual INSERT or skip for each actor link (M queries)
- Separate DELETE for duplicate event

**After**:
- `merge_duplicate_event(p_primary_id, p_duplicate_id)` - Single transaction handling everything
  - `merge_event_post_links()` - Moves unique post links in one query
  - `merge_event_actor_links()` - Moves unique actor links in one query
  - Deletes duplicate event
  - Returns statistics (moved counts, duplicate counts)

**Performance**:
- Before: Event with 50 post links + 20 actor links = ~140+ queries (check + update/delete for each)
- After: 1 RPC call
- **Improvement: 140x fewer queries per merge operation**

### 4. Twitter Scraper (~10x faster timestamp updates)

**File**: `automation/scrapers/twitter_scraper.py`

**Before**:
- Individual UPDATE query for each Twitter handle's `last_scrape` timestamp
- Called after each batch of tweets saved

**After**:
- `bulk_update_last_scrape(actor_ids[], scrape_timestamp)` - Single UPDATE for all handles
- Falls back to individual updates if RPC fails (for backward compatibility)

**Performance**:
- Before: 10 handles = 10 UPDATE queries
- After: 10 handles = 1 UPDATE query
- **Improvement: 10x fewer queries**

Alternative function available:
- `bulk_update_last_scrape_by_username(usernames[])` - For cases where actor_id not readily available

### 5. Flash Event Processor (already optimized)

**File**: `automation/processors/flash_standalone_event_processor.py`

**Current State**: Already uses efficient batch operations with `.upsert()` and ON CONFLICT handling.

**RPC Functions Created** (for future use if needed):
- `bulk_upsert_event_actor_links(links_jsonb)` - Batch create event-actor links
- `check_missing_post_actor_links(post_actor_pairs_jsonb)` - Returns which links don't exist
- `bulk_insert_post_actor_links(links_jsonb)` - Batch create post-actor links

**Note**: These RPC functions provide only marginal benefit since the processor already uses batch upserts. They're available for future optimizations if needed.

## RPC Function Reference

### Media Downloader Functions

```sql
-- Get posts needing media download (excludes EXPIRED)
get_posts_needing_media(batch_limit INT DEFAULT 200)
  RETURNS TABLE (post_id UUID, media_url TEXT)

-- Bulk update offline_image_url
bulk_update_post_images(updates JSONB)
  RETURNS INT  -- count of updated rows

-- JSONB format:
-- [{"id": "uuid", "offline_image_url": "url_or_status"}, ...]
```

### Post Processor Functions

```sql
-- Bulk insert posts with ON CONFLICT handling
bulk_insert_posts(posts JSONB)
  RETURNS TABLE(inserted_id UUID, post_id_value TEXT, was_inserted BOOLEAN)

-- Check which post_ids already exist (legacy, not actively used)
check_existing_post_ids(post_ids TEXT[])
  RETURNS TEXT[]
```

### Event Deduplicator Functions

```sql
-- Complete merge operation (combines all steps)
merge_duplicate_event(p_primary_id UUID, p_duplicate_id UUID)
  RETURNS JSONB  -- {posts_moved, posts_duplicates, actors_moved, actors_duplicates, success}

-- Individual operations (used by merge_duplicate_event)
merge_event_post_links(p_primary_id UUID, p_duplicate_id UUID)
  RETURNS TABLE(moved_count INT, duplicate_count INT)

merge_event_actor_links(p_primary_id UUID, p_duplicate_id UUID)
  RETURNS TABLE(moved_count INT, duplicate_count INT)
```

### Twitter Scraper Functions

```sql
-- Bulk update last_scrape by actor_id
bulk_update_last_scrape(actor_ids UUID[], scrape_timestamp TIMESTAMPTZ DEFAULT NOW())
  RETURNS INT  -- count of updated rows

-- Alternative: bulk update by username
bulk_update_last_scrape_by_username(usernames TEXT[], scrape_timestamp TIMESTAMPTZ DEFAULT NOW())
  RETURNS INT  -- count of updated rows
```

### Flash Event Processor Functions (available but not actively used)

```sql
-- Bulk upsert event-actor links
bulk_upsert_event_actor_links(links JSONB)
  RETURNS INT  -- count of affected rows

-- Check missing post-actor links
check_missing_post_actor_links(post_actor_pairs JSONB)
  RETURNS TABLE(post_id UUID, actor_id UUID)

-- Bulk insert post-actor links
bulk_insert_post_actor_links(links JSONB)
  RETURNS INT  -- count of inserted rows
```

## Permissions

All RPC functions are granted execute permission to:
- `authenticated` - For use by authenticated users via Supabase client
- `service_role` - For use by automation scripts with service role key

## Testing

To test the optimizations:

1. Apply SQL files to database
2. Run a test automation with limited scope:
   ```bash
   # Set conservative test limits in .env
   NUM_ACCOUNTS=5
   TWITTER_HANDLE_LIMIT=10
   MAX_RESULTS_PER_USER=50
   ```
3. Monitor logs for RPC function calls:
   - Look for "bulk query" messages
   - Check for "Moved X unique post links" in deduplicator
   - Verify "Updated X handle timestamps in single bulk query" in scraper

## Fallback Handling

All scripts include fallback logic:
- If RPC call fails, falls back to individual queries
- Ensures backward compatibility
- Provides detailed error messages for debugging

## Future Optimizations

Potential areas for further optimization:
- Batch geocoding requests in `backfill_coordinates.py`
- Parallel processing for event extraction in flash processor
- Connection pooling for high-concurrency scenarios
