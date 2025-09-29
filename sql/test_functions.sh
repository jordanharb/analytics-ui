#!/bin/bash

# Test script for people_id migration functions
# Usage: ./test_functions.sh

SUPABASE_URL="https://ffdrtpknppmtkkbqsvek.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZHJ0cGtucHBtdGtrYnFzdmVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkxMzg3NiwiZXhwIjoyMDY3NDg5ODc2fQ.Vy6VzGOHWbTZNlRg_tZcyP3Y05LFf4g5sHYD6oaRY0s"

echo "🔍 Testing People ID Migration Functions"
echo "======================================="

# First, let's get a valid people_id to use for testing
echo ""
echo "1. Getting a sample people_id from search_people_with_sessions..."

SEARCH_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_people_with_sessions" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_search_term": ""}')

echo "Search result: $SEARCH_RESULT" | jq '.[0:2]'

# Extract the first person_id from the result
PERSON_ID=$(echo "$SEARCH_RESULT" | jq -r '.[0].person_id // empty')

if [ -z "$PERSON_ID" ]; then
    echo "❌ Could not get a valid person_id. Exiting."
    exit 1
fi

echo "✅ Using person_id: $PERSON_ID"

# Get session info for this person
echo ""
echo "2. Getting session info for person $PERSON_ID..."

SESSION_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/get_person_sessions" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{\"p_person_id\": $PERSON_ID}")

echo "Session result: $SESSION_RESULT" | jq '.[0:2]'

# Extract the first session_id
SESSION_ID=$(echo "$SESSION_RESULT" | jq -r '.[0].session_id // empty')

if [ -z "$SESSION_ID" ]; then
    echo "❌ Could not get a valid session_id. Using default 57."
    SESSION_ID=57
fi

echo "✅ Using session_id: $SESSION_ID"

echo ""
echo "======================================="
echo "🧪 TESTING UPDATED FUNCTIONS"
echo "======================================="

# Test 1: search_bills_for_legislator_optimized
echo ""
echo "3. Testing search_bills_for_legislator_optimized..."

BILLS_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_bills_for_legislator_optimized" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{
    \"p_person_id\": $PERSON_ID,
    \"p_session_id\": $SESSION_ID,
    \"p_search_terms\": [\"water\"],
    \"p_limit\": 5
  }")

if echo "$BILLS_RESULT" | jq empty 2>/dev/null; then
    BILLS_COUNT=$(echo "$BILLS_RESULT" | jq length)
    echo "✅ search_bills_for_legislator_optimized: SUCCESS - returned $BILLS_COUNT results"
    echo "Sample result:"
    echo "$BILLS_RESULT" | jq '.[0] // "No results"'
else
    echo "❌ search_bills_for_legislator_optimized: FAILED"
    echo "Error: $BILLS_RESULT"
fi

# Test 2: search_donor_totals_window
echo ""
echo "4. Testing search_donor_totals_window..."

DONORS_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_donor_totals_window" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{
    \"p_person_id\": $PERSON_ID,
    \"p_session_id\": $SESSION_ID,
    \"p_limit\": 5
  }")

if echo "$DONORS_RESULT" | jq empty 2>/dev/null; then
    DONORS_COUNT=$(echo "$DONORS_RESULT" | jq length)
    echo "✅ search_donor_totals_window: SUCCESS - returned $DONORS_COUNT results"
    echo "Sample result:"
    echo "$DONORS_RESULT" | jq '.[0] // "No results"'
else
    echo "❌ search_donor_totals_window: FAILED"
    echo "Error: $DONORS_RESULT"
fi

# Test 3: list_donor_transactions_window
echo ""
echo "5. Testing list_donor_transactions_window..."

TRANSACTIONS_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/list_donor_transactions_window" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{
    \"p_person_id\": $PERSON_ID,
    \"p_session_id\": $SESSION_ID,
    \"p_limit\": 5
  }")

if echo "$TRANSACTIONS_RESULT" | jq empty 2>/dev/null; then
    TRANSACTIONS_COUNT=$(echo "$TRANSACTIONS_RESULT" | jq length)
    echo "✅ list_donor_transactions_window: SUCCESS - returned $TRANSACTIONS_COUNT results"
    echo "Sample result:"
    echo "$TRANSACTIONS_RESULT" | jq '.[0] // "No results"'
else
    echo "❌ list_donor_transactions_window: FAILED"
    echo "Error: $TRANSACTIONS_RESULT"
fi

# Test 4: Verify old function signatures are gone
echo ""
echo "6. Testing that old function signatures are removed..."

OLD_BILLS_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_bills_for_legislator_optimized" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{
    \"p_legislator_id\": 123,
    \"p_session_id\": $SESSION_ID,
    \"p_limit\": 5
  }")

if echo "$OLD_BILLS_RESULT" | grep -q "function.*does not exist\|could not find function"; then
    echo "✅ Old legislator_id function signature removed successfully"
else
    echo "⚠️  Old function signature may still exist"
    echo "Response: $OLD_BILLS_RESULT"
fi

echo ""
echo "======================================="
echo "📊 TEST SUMMARY"
echo "======================================="
echo "Person ID used: $PERSON_ID"
echo "Session ID used: $SESSION_ID"
echo ""
echo "Functions tested:"
echo "- search_bills_for_legislator_optimized (people_id version)"
echo "- search_donor_totals_window (people_id version)"
echo "- list_donor_transactions_window (people_id version)"
echo ""
echo "✅ Testing completed!"