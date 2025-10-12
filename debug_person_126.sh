#!/bin/bash

# Debug script specifically for person_id 126
# Investigating entity mapping issue

SUPABASE_URL="https://ffdrtpknppmtkkbqsvek.supabase.co"
SUPABASE_KEY="YOUR_SUPABASE_SERVICE_KEY"

PERSON_ID=126

echo "🔍 Investigating person_id $PERSON_ID mapping"
echo "============================================="

# Check if person_id 126 exists in the people search
echo "1. Searching for person_id $PERSON_ID in search results..."

SPECIFIC_PERSON_SEARCH=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_people_with_sessions" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_search_term": ""}')

# Look for person_id 126 in the results
echo "Checking if person_id $PERSON_ID is in the search results..."
PERSON_FOUND=$(echo "$SPECIFIC_PERSON_SEARCH" | jq ".[] | select(.person_id == $PERSON_ID)")

if [ -n "$PERSON_FOUND" ]; then
    echo "✅ Found person_id $PERSON_ID:"
    echo "$PERSON_FOUND"
else
    echo "❌ Person_id $PERSON_ID not found in search results"
    echo "First 5 person_ids in results:"
    echo "$SPECIFIC_PERSON_SEARCH" | jq '.[0:5] | map(.person_id)' 2>/dev/null || echo "No valid results"
fi

# Let's check what the mv_entities_search table looks like by finding a valid person_id
echo ""
echo "2. Getting a valid person_id to check mv_entities_search structure..."

VALID_PERSON=$(echo "$SPECIFIC_PERSON_SEARCH" | jq -r '.[0].person_id // empty' 2>/dev/null)
if [ -n "$VALID_PERSON" ]; then
    echo "Using valid person_id: $VALID_PERSON"

    # Try to use the search_donor_totals_window with a valid person_id to see if it works
    echo ""
    echo "3. Testing search_donor_totals_window with valid person_id $VALID_PERSON..."

    VALID_TEST=$(curl -s -X POST \
      "${SUPABASE_URL}/rest/v1/rpc/search_donor_totals_window" \
      -H "Authorization: Bearer ${SUPABASE_KEY}" \
      -H "Content-Type: application/json" \
      -H "apikey: ${SUPABASE_KEY}" \
      -d "{
        \"p_person_id\": $VALID_PERSON,
        \"p_session_id\": 125,
        \"p_days_before\": 30,
        \"p_days_after\": 30,
        \"p_min_amount\": 0,
        \"p_limit\": 25
      }")

    if echo "$VALID_TEST" | jq empty 2>/dev/null; then
        VALID_COUNT=$(echo "$VALID_TEST" | jq length)
        echo "✅ Valid person_id test returned $VALID_COUNT results"
        if [ "$VALID_COUNT" -gt 0 ]; then
            echo "Sample result:"
            echo "$VALID_TEST" | jq '.[0]'
        fi
    else
        echo "❌ Valid person_id test failed: $VALID_TEST"
    fi
else
    echo "❌ Could not get a valid person_id for comparison"
fi

# Check if there are any transactions for entity_ids around 126
echo ""
echo "4. Checking for transactions with entity_ids around $PERSON_ID..."

ENTITY_RANGE_CHECK=$(curl -s -X GET \
  "${SUPABASE_URL}/rest/v1/cf_transactions?entity_id=gte.120&entity_id=lte.130&limit=5" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "apikey: ${SUPABASE_KEY}")

echo "Transactions with entity_ids 120-130:"
if echo "$ENTITY_RANGE_CHECK" | jq empty 2>/dev/null; then
    RANGE_COUNT=$(echo "$ENTITY_RANGE_CHECK" | jq length)
    echo "Found $RANGE_COUNT transactions in entity_id range 120-130"
    if [ "$RANGE_COUNT" -gt 0 ]; then
        echo "Entity IDs found:"
        echo "$ENTITY_RANGE_CHECK" | jq '.[].entity_id' | sort -n | uniq
    fi
else
    echo "❌ Error checking entity range: $ENTITY_RANGE_CHECK"
fi

# Check the maximum person_id in the search results
echo ""
echo "5. Checking the range of person_ids available..."

MAX_PERSON_ID=$(echo "$SPECIFIC_PERSON_SEARCH" | jq 'map(.person_id) | max' 2>/dev/null)
MIN_PERSON_ID=$(echo "$SPECIFIC_PERSON_SEARCH" | jq 'map(.person_id) | min' 2>/dev/null)

echo "Person ID range in search results: $MIN_PERSON_ID to $MAX_PERSON_ID"

if [ "$PERSON_ID" -gt "$MAX_PERSON_ID" ] 2>/dev/null; then
    echo "❌ ISSUE: Person_id $PERSON_ID is higher than maximum available ($MAX_PERSON_ID)"
elif [ "$PERSON_ID" -lt "$MIN_PERSON_ID" ] 2>/dev/null; then
    echo "❌ ISSUE: Person_id $PERSON_ID is lower than minimum available ($MIN_PERSON_ID)"
else
    echo "⚠️  Person_id $PERSON_ID is within the expected range but not found"
fi

echo ""
echo "============================================="
echo "📊 PERSON MAPPING SUMMARY"
echo "============================================="
echo "Investigation results:"
echo "- Person_id $PERSON_ID existence in search: $([ -n "$PERSON_FOUND" ] && echo "FOUND" || echo "NOT FOUND")"
echo "- Valid person_id test: $([ -n "$VALID_PERSON" ] && echo "$VALID_PERSON" || echo "NONE")"
echo "- Person_id range: $MIN_PERSON_ID to $MAX_PERSON_ID"
echo ""
echo "Next steps if person_id $PERSON_ID is not found:"
echo "1. Use a valid person_id from the search results"
echo "2. Check if person_id $PERSON_ID exists in the underlying tables"
echo "3. Verify the mv_entities_search materialized view is up to date"