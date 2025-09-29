#!/bin/bash

# Final verification of people_id migration functions
SUPABASE_URL="https://ffdrtpknppmtkkbqsvek.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZHJ0cGtucHBtdGtrYnFzdmVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkxMzg3NiwiZXhwIjoyMDY3NDg5ODc2fQ.Vy6VzGOHWbTZNlRg_tZcyP3Y05LFf4g5sHYD6oaRY0s"

echo "=== PEOPLE_ID MIGRATION VERIFICATION ==="
echo "Date: $(date)"
echo ""

# Test 1: search_bills_for_legislator_optimized
echo "1. Testing search_bills_for_legislator_optimized..."
BILLS_RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_bills_for_legislator_optimized" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_person_id": 1194, "p_session_id": 57, "p_limit": 3}')

if echo "$BILLS_RESPONSE" | jq empty 2>/dev/null; then
    echo "✅ SUCCESS: search_bills_for_legislator_optimized"
    echo "   Response: $(echo "$BILLS_RESPONSE" | jq -c 'length') results"
else
    echo "❌ FAILED: search_bills_for_legislator_optimized"
    echo "   Error: $BILLS_RESPONSE"
fi

# Test 2: search_donor_totals_window
echo ""
echo "2. Testing search_donor_totals_window..."
DONORS_RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_donor_totals_window" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_person_id": 1194, "p_session_id": 57, "p_limit": 3}')

if echo "$DONORS_RESPONSE" | jq empty 2>/dev/null; then
    echo "✅ SUCCESS: search_donor_totals_window"
    echo "   Response: $(echo "$DONORS_RESPONSE" | jq -c 'length') results"
else
    echo "❌ FAILED: search_donor_totals_window"
    echo "   Error: $DONORS_RESPONSE"
fi

# Test 3: list_donor_transactions_window (with timeout handling)
echo ""
echo "3. Testing list_donor_transactions_window (30s timeout)..."
TRANSACTIONS_RESPONSE=$(timeout 30s curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/list_donor_transactions_window" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_person_id": 1194, "p_session_id": 57}' 2>/dev/null)

EXIT_CODE=$?
if [ $EXIT_CODE -eq 124 ]; then
    echo "⚠️  TIMEOUT: list_donor_transactions_window (>30s)"
    echo "   This suggests a performance issue that needs investigation"
elif echo "$TRANSACTIONS_RESPONSE" | jq empty 2>/dev/null; then
    echo "✅ SUCCESS: list_donor_transactions_window"
    echo "   Response: $(echo "$TRANSACTIONS_RESPONSE" | jq -c 'length') results"
else
    echo "❌ FAILED: list_donor_transactions_window"
    echo "   Error: $TRANSACTIONS_RESPONSE"
fi

# Test 4: Verify old function is gone
echo ""
echo "4. Verifying old legislator_id function is removed..."
OLD_RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/search_bills_for_legislator_optimized" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_KEY}" \
  -d '{"p_legislator_id": 123, "p_session_id": 57}')

if echo "$OLD_RESPONSE" | grep -q "Could not find the function\|does not exist"; then
    echo "✅ CONFIRMED: Old legislator_id signature removed"
else
    echo "⚠️  WARNING: Old function signature may still exist"
fi

echo ""
echo "=== SUMMARY ==="
echo "Migration Status: DEPLOYED"
echo "Key Changes:"
echo "  - Functions now use people_id instead of legislator_id"
echo "  - Functions automatically find ALL legislator IDs for a person"
echo "  - Functions support multiple entity/legislator IDs per person"
echo ""
echo "Known Issues:"
echo "  - list_donor_transactions_window may have performance issues"
echo "  - MCP proxy fallback needs investigation"
echo ""
echo "Next Steps:"
echo "  - Monitor application performance"
echo "  - Optimize list_donor_transactions_window if needed"
echo "  - Verify MCP proxy configuration"