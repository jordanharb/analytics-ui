#!/bin/bash

# Debug script for search_donor_totals_window function
# Investigating why person_id 126, session_id 125 returns no results

SUPABASE_URL="https://ffdrtpknppmtkkbqsvek.supabase.co"
SUPABASE_KEY="YOUR_SUPABASE_SERVICE_KEY"

PERSON_ID=126
SESSION_ID=125
DAYS_BEFORE=30
DAYS_AFTER=30
MIN_AMOUNT=0
LIMIT=25

echo "🔍 Debugging search_donor_totals_window function"
echo "==============================================="
echo "Test parameters:"
echo "- Person ID: $PERSON_ID"
echo "- Session ID: $SESSION_ID"
echo "- Days before: $DAYS_BEFORE"
echo "- Days after: $DAYS_AFTER"
echo "- Min amount: $MIN_AMOUNT"
echo "- Limit: $LIMIT"
echo ""

# Step 1: Check if person_id 126 exists in mv_entities_search
echo "1. Checking if person_id $PERSON_ID exists in mv_entities_search..."

ENTITY_CHECK=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/sql" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{
    "query": "SELECT person_id, all_entity_ids FROM mv_entities_search WHERE person_id = 126;"
  }')

echo "Entity check result: $ENTITY_CHECK"

# If direct SQL doesn't work, try getting the data via the function interface
echo ""
echo "1b. Alternative: Checking via search interface..."

PERSON_SEARCH=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_people_with_sessions" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_search_term": ""}')

echo "Sample people search (first 3 results):"
echo "$PERSON_SEARCH" | jq '.[0:3] | map({person_id, label})'

# Step 2: Check if session_id 125 exists and get its date range
echo ""
echo "2. Checking session_id $SESSION_ID and its date range..."

SESSION_WINDOW=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/session_window" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{
    \"p_session_id\": $SESSION_ID,
    \"p_days_before\": $DAYS_BEFORE,
    \"p_days_after\": $DAYS_AFTER
  }")

echo "Session window result: $SESSION_WINDOW"

# Step 3: Test the actual function call that's failing
echo ""
echo "3. Testing the actual search_donor_totals_window function call..."

DONORS_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_donor_totals_window" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d "{
    \"p_person_id\": $PERSON_ID,
    \"p_session_id\": $SESSION_ID,
    \"p_days_before\": $DAYS_BEFORE,
    \"p_days_after\": $DAYS_AFTER,
    \"p_min_amount\": $MIN_AMOUNT,
    \"p_limit\": $LIMIT
  }")

echo "Donor totals result: $DONORS_RESULT"

if echo "$DONORS_RESULT" | jq empty 2>/dev/null; then
    DONORS_COUNT=$(echo "$DONORS_RESULT" | jq length)
    echo "✅ Function executed successfully - returned $DONORS_COUNT results"
    if [ "$DONORS_COUNT" -gt 0 ]; then
        echo "Sample result:"
        echo "$DONORS_RESULT" | jq '.[0]'
    else
        echo "❌ ISSUE: Function returned 0 results"
    fi
else
    echo "❌ Function call failed with error: $DONORS_RESULT"
fi

# Step 4: Check cf_transactions table for any data at all
echo ""
echo "4. Checking cf_transactions table structure and sample data..."

# Let's try to get some sample transaction data to understand the table structure
SAMPLE_TRANSACTIONS=$(curl -s -X GET \
  "${SUPABASE_URL}/rest/v1/cf_transactions?limit=3" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "apikey: ${SUPABASE_KEY}")

echo "Sample transactions (structure check):"
echo "$SAMPLE_TRANSACTIONS" | jq '.[0] | keys' 2>/dev/null || echo "Could not retrieve sample transactions: $SAMPLE_TRANSACTIONS"

# Step 5: Check if there are any transactions with transaction_type_disposition_id = 1
echo ""
echo "5. Checking for donation transactions (type_disposition_id = 1)..."

DONATION_CHECK=$(curl -s -X GET \
  "${SUPABASE_URL}/rest/v1/cf_transactions?transaction_type_disposition_id=eq.1&limit=1" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "apikey: ${SUPABASE_KEY}")

echo "Donation transactions check: $DONATION_CHECK"

if echo "$DONATION_CHECK" | jq empty 2>/dev/null; then
    DONATION_COUNT=$(echo "$DONATION_CHECK" | jq length)
    if [ "$DONATION_COUNT" -gt 0 ]; then
        echo "✅ Found donation transactions in the database"
    else
        echo "❌ ISSUE: No transactions with transaction_type_disposition_id = 1 found"
    fi
else
    echo "❌ Error checking donation transactions: $DONATION_CHECK"
fi

echo ""
echo "==============================================="
echo "📊 DIAGNOSTIC SUMMARY"
echo "==============================================="
echo "This script tested the following:"
echo "1. Person ID $PERSON_ID existence in mv_entities_search"
echo "2. Session ID $SESSION_ID and date range calculation"
echo "3. Direct function call with exact parameters"
echo "4. cf_transactions table structure and data"
echo "5. Donation transactions availability"
echo ""
echo "Review the output above to identify the root cause."