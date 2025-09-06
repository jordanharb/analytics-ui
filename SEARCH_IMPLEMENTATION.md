# Search Implementation Status

## Current State
The search UI is fully implemented with the following features:
- Search bar with Enter key submission (no auto-search on typing)
- Active search displays as a token with clear button
- Search state properly managed in filters store
- API client prepared to send search queries to backend

## Frontend Implementation
✅ **SearchBar Component** (`src/components/SearchBar/SearchBar.tsx`)
- Press Enter to search
- Shows search as removable token when active
- "Press Enter" hint when typing

✅ **Filters Store** (`src/state/filtersStore.ts`)
- Manages search query state
- Integrates with filter application flow
- Properly clears search when removed

✅ **API Client** (`src/api/analyticsClient.ts`)
- Adds `search_text` to filters when search is active
- Ready to use vector search endpoint when available

## Backend Requirements

### Option 1: Text-to-Embedding on Backend (Recommended)
The backend needs to:
1. Accept `search_text` parameter in filters
2. Generate embedding using Google's text-embedding-004 model (same as existing data)
3. Call `fn_select_events_vec` with the generated embedding
4. Return filtered results

### Option 2: Client-side Embedding Generation
Would require:
1. Setting up an API endpoint to generate embeddings
2. Calling Google's API from the frontend
3. Passing the embedding vector to backend

## SQL Functions Ready
✅ **fn_select_events_vec** - Vector search function using cosine similarity
✅ **IVFFlat index** - Optimized index for vector searches
✅ **pgvector extension** - Installed and configured

## To Complete Integration

### Backend Changes Needed
```sql
-- Add to get_map_points and other functions
IF p_filters->>'search_text' IS NOT NULL THEN
  -- Generate embedding from text using your Python backend
  -- Call fn_select_events_vec with the embedding
  -- Filter results by returned event IDs
END IF;
```

### Or Add Text Search Fallback
```sql
-- Simple text search as fallback
IF p_filters->>'search_text' IS NOT NULL THEN
  -- Use PostgreSQL full-text search on event_name and event_description
  -- Filter events using to_tsvector and to_tsquery
END IF;
```

## Testing
Once backend support is added:
1. Enter search query and press Enter
2. Verify search token appears
3. Check console logs for debugging output
4. Verify filtered results on map/directory
5. Click X on token to clear search

## Debug Output
The following console logs are available:
- "Applying search: [query]" - When search is submitted
- "Clearing search" - When search is cleared  
- "Search detected in getMapPoints/getDirectoryEvents" - When API calls include search
- "Final filters for [endpoint]" - Shows complete filter object sent to backend