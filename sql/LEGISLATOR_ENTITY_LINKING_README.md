# Legislator-Entity Linking Scripts

This directory contains scripts to link legislators with their campaign finance entities. The issue is that the `mv_legislators_search` table shows `all_entity_ids` as null for all legislators, indicating that the `rs_person_cf_entities` table is not properly populated.

## Problem

The materialized view `mv_legislators_search` aggregates entity IDs from the `rs_person_cf_entities` table, but this table is empty or not properly linked. This means legislators don't show their associated campaign finance entities.

## Solution

We need to populate the `rs_person_cf_entities` table by matching legislator names with entity names from the `cf_entity_records` table.

## Scripts Available

### 1. `quick_legislator_entity_link.sql` (Start Here)
- **Purpose**: Quick exact matching using simple SQL
- **What it does**: Matches legislator names exactly with entity names, candidate names, and committee names
- **Handles**: "Last, First" format conversion to "First Last"
- **Run this first** to get basic matches

### 2. `comprehensive_legislator_entity_linking.sql`
- **Purpose**: More sophisticated matching with fuzzy logic
- **What it does**: Uses similarity functions and multiple matching strategies
- **Requires**: `pg_trgm` extension for similarity functions
- **Run this** for better matching after the quick script

### 3. `link_legislators_to_entities.sql`
- **Purpose**: Advanced fuzzy matching with confidence scoring
- **What it does**: Uses PostgreSQL's similarity function and confidence levels
- **Requires**: `pg_trgm` extension
- **Run this** for the most comprehensive matching

### 4. `test_legislator_entity_linking.sql`
- **Purpose**: Test and verify the current state
- **What it does**: Shows current statistics and potential matches
- **Run this** to check results before and after linking

### 5. `scripts/link_legislators_to_entities.py`
- **Purpose**: Python script for advanced fuzzy matching
- **What it does**: Uses Python's difflib for better string matching
- **Requires**: Python with psycopg2
- **Run this** for the best matching results

## How to Use

### Step 1: Test Current State
```sql
\i sql/test_legislator_entity_linking.sql
```

### Step 2: Quick Exact Matching
```sql
\i sql/quick_legislator_entity_link.sql
```

### Step 3: Check Results
```sql
\i sql/test_legislator_entity_linking.sql
```

### Step 4: Advanced Matching (Optional)
```sql
\i sql/comprehensive_legislator_entity_linking.sql
```

### Step 5: Python Script (Optional)
```bash
cd scripts
python link_legislators_to_entities.py
```

## Expected Results

After running these scripts, you should see:
- Legislators with `all_entity_ids` populated in `mv_legislators_search`
- Campaign finance data linked to legislators
- Better search results in the legislature module

## Manual Overrides

For difficult cases, you can manually insert relationships:
```sql
INSERT INTO rs_person_cf_entities (person_id, entity_id)
VALUES (person_id, entity_id);
```

## Verification

Check the results with:
```sql
SELECT 
  display_name,
  legislator_name,
  all_entity_ids,
  primary_committee_name,
  primary_candidate_name
FROM mv_legislators_search
WHERE all_entity_ids IS NOT NULL 
  AND array_length(all_entity_ids, 1) > 0
ORDER BY display_name;
```

## Notes

- The scripts handle various name formats including "Last, First" conversion
- Confidence scoring helps identify the best matches
- The materialized view needs to be refreshed after inserting new relationships
- Some manual review may be needed for edge cases


