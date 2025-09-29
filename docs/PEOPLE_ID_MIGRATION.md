# People ID Migration Documentation

**Date:** September 30, 2024
**Migration:** Standardize all legislator-based functions to use `people_id` instead of `legislator_id`

## Problem Statement

The application was experiencing issues with incorrect legislative IDs being used throughout the system. Different functions were using individual `legislator_id` parameters, but legislators often have multiple IDs across different sessions and contexts. This caused incomplete or incorrect data retrieval.

## Solution

Migrated all legislator-based functions to use the canonical `people_id` from the `mv_entities_search` materialized view, which contains arrays of all related IDs (`all_legislator_ids`, `all_entity_ids`, `all_session_ids`) for each person.

## Key Changes

### 1. Database Function Updates

**Functions Modified:**
- `search_bills_for_legislator_optimized`
- `search_donor_totals_window`
- `list_donor_transactions_window`

**Core Pattern:**
- **Before:** Accept single `legislator_id` parameter
- **After:** Accept `people_id` parameter, lookup all related legislator IDs from `mv_entities_search`, use ALL of them in queries

### 2. Client-Side Updates

**File:** `/src/legislature/ReportGeneratorPage.tsx`

**Functions Updated:**
- `searchBillsForLegislatorRpc()` - Changed parameter from `legislatorId` to `personId`
- `buildTransactionWindowPayload()` - Added `personId` parameter
- `listDonorTransactionsWindow()` - Added `personId` parameter
- Updated all function calls to pass `currentPersonId` instead of individual legislator IDs

## Technical Implementation

### Database Function Pattern

```sql
-- NEW PATTERN: Get all legislator IDs for a person
WITH person_legislators AS (
  SELECT UNNEST(m.all_legislator_ids) AS legislator_id
  FROM mv_entities_search m
  WHERE m.person_id = p_person_id
)
```

### Entity ID Pattern

```sql
-- NEW PATTERN: Get all entity IDs for a person
IF p_person_id IS NOT NULL THEN
  SELECT m.all_entity_ids INTO v_entity_ids
  FROM mv_entities_search m
  WHERE m.person_id = p_person_id;
END IF;
```

## Function Signatures Changed

### search_bills_for_legislator_optimized

**Before:**
```sql
search_bills_for_legislator_optimized(
  p_legislator_id integer,
  p_session_id integer,
  ...
)
```

**After:**
```sql
search_bills_for_legislator_optimized(
  p_person_id bigint,
  p_session_id integer,
  ...
)
```

### search_donor_totals_window

**Before:**
```sql
search_donor_totals_window(
  p_recipient_entity_ids integer[],
  p_session_id integer,
  ...
)
```

**After:**
```sql
search_donor_totals_window(
  p_person_id bigint DEFAULT NULL,
  p_recipient_entity_ids integer[] DEFAULT NULL,
  p_session_id integer DEFAULT NULL,
  ...
)
```

### list_donor_transactions_window

**Before:**
```sql
list_donor_transactions_window(
  p_recipient_entity_ids integer[],
  p_session_id integer,
  ...
)
```

**After:**
```sql
list_donor_transactions_window(
  p_person_id bigint DEFAULT NULL,
  p_recipient_entity_ids integer[] DEFAULT NULL,
  p_session_id integer DEFAULT NULL,
  ...
)
```

## Benefits

1. **Comprehensive Data Retrieval:** Functions now automatically find and use ALL legislator IDs associated with a person
2. **Consistency:** Single canonical ID (`people_id`) used throughout the system
3. **Flexibility:** Functions still accept additional entity IDs for backward compatibility
4. **Accuracy:** No more missed data due to using wrong legislator ID

## Migration Steps Completed

✅ 1. Analyzed materialized view structure (`mv_entities_search`)
✅ 2. Updated database functions to use `people_id` pattern
✅ 3. Updated client-side code to pass `people_id`
✅ 4. Created deployment SQL files
✅ 5. Deployed functions to Supabase database

## Files Modified

**SQL Functions:**
- `sql/supabase_editor_functions.sql` - Deployment-ready SQL functions
- `sql/migrate_to_people_id.sql` - Complete migration with documentation
- `docs/theme functions.md` - Updated function definitions

**Client Code:**
- `src/legislature/ReportGeneratorPage.tsx` - Updated function calls and parameters

## Usage Notes

### For Developers

1. **Always use `people_id`:** When working with legislator-related functions, always pass the `people_id` from `search_people_with_sessions`
2. **Backward Compatibility:** The `p_recipient_entity_ids` parameter is still available for additional filtering
3. **Error Handling:** Functions will return empty results if `people_id` doesn't exist in `mv_entities_search`

### For Users

The migration is transparent to end users. The application will now return more complete results when analyzing legislators who have multiple IDs across different sessions or contexts.

## Deployment Instructions

1. Copy contents of `sql/supabase_editor_functions.sql`
2. Navigate to Supabase Dashboard > SQL Editor
3. Paste and execute the SQL functions
4. Deploy the updated client code

## Testing

After deployment, verify:
1. Search for a legislator in the Report Generator
2. Confirm that `people_id` is being used in network requests
3. Verify that all related bills and donations are found (should see more comprehensive results)
4. Check browser console for any function call errors

---

**Migration Status:** ✅ COMPLETED
**Database Version:** Functions updated to use people_id pattern
**Client Version:** ReportGeneratorPage updated to use people_id