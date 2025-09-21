#!/bin/bash

# Helper script to run session-specific analysis in two phases
# Usage: ./run_session_analysis.sh "Legislator Name"

if [ -z "$1" ]; then
    echo "Usage: $0 \"Legislator Name\""
    echo "Example: $0 \"Daniel Hernandez\""
    exit 1
fi

LEGISLATOR_NAME="$1"
echo "Analyzing legislator: $LEGISLATOR_NAME"

# Phase 1: Generate bill-donation pairing list
echo ""
echo "=== PHASE 1: Generating bill-donation pairing list ==="
echo ""

# Create a temporary file for JSON output
TEMP_JSON=$(mktemp)

# Run Phase 1 interactively - stderr shows progress, stdout goes to temp file
LEGISLATOR_NAME="$LEGISLATOR_NAME" IS_INITIAL="true" PHASE="1" \
    node scripts/gemini_chat_api_session.mjs > "$TEMP_JSON"

# Read the JSON output from temp file
PHASE1_JSON=$(cat "$TEMP_JSON")
rm -f "$TEMP_JSON"

# Check if phase 1 succeeded
if [ $? -ne 0 ] || [ -z "$PHASE1_JSON" ]; then
    echo "Error in Phase 1:"
    echo "$PHASE1_OUTPUT"
    exit 1
fi

# Extract selected session ID and pairing data
SELECTED_SESSION_ID=$(echo "$PHASE1_JSON" | jq -r '.selectedSessionId' 2>/dev/null)
SELECTED_SESSION_NAME=$(echo "$PHASE1_JSON" | jq -r '.selectedSessionName' 2>/dev/null)

# Extract the response - it might already be JSON or might be a string containing JSON
RESPONSE_DATA=$(echo "$PHASE1_JSON" | jq -r '.response' 2>/dev/null)
if [ -z "$RESPONSE_DATA" ] || [ "$RESPONSE_DATA" = "null" ]; then
    echo "Error: Could not extract response from Phase 1"
    echo "Raw JSON: $PHASE1_JSON"
    exit 1
fi

# Clean up the response if it's wrapped in markdown code blocks
if echo "$RESPONSE_DATA" | grep -q '```json'; then
    # Extract JSON from markdown code block using Python for cross-platform compatibility
    PAIRING_DATA=$(echo "$RESPONSE_DATA" | python3 -c "
import sys
data = sys.stdin.read()
start = data.find('{')
end = data.rfind('}') + 1
if start >= 0 and end > start:
    print(data[start:end])
")
else
    # Try to parse the response as JSON
    PAIRING_DATA=$(echo "$RESPONSE_DATA" | jq '.' 2>/dev/null || echo "$RESPONSE_DATA")
fi

echo "Selected Session: $SELECTED_SESSION_NAME (ID: $SELECTED_SESSION_ID)"
echo ""

# Create directory structure: reports/[Legislator Name]/[Session Name]/
SAFE_LEGISLATOR_NAME=$(echo "$LEGISLATOR_NAME" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')
SAFE_SESSION_NAME=$(echo "$SELECTED_SESSION_NAME" | tr ' ' '_' | tr '/' '-')
REPORT_DIR="reports/${SAFE_LEGISLATOR_NAME}/${SAFE_SESSION_NAME}"
mkdir -p "$REPORT_DIR"

# Save Phase 1 output
echo "$PAIRING_DATA" > "${REPORT_DIR}/potential_pairings.json"
echo "Phase 1 output saved to ${REPORT_DIR}/potential_pairings.json"

# Count statistics (with error handling)
HIGH_CONFIDENCE=$(echo "$PAIRING_DATA" | jq '[.potential_pairs[]? | select(.confidence_score >= 0.7)] | length' 2>/dev/null || echo "0")
MEDIUM_CONFIDENCE=$(echo "$PAIRING_DATA" | jq '[.potential_pairs[]? | select(.confidence_score >= 0.4 and .confidence_score < 0.7)] | length' 2>/dev/null || echo "0")
LOW_CONFIDENCE=$(echo "$PAIRING_DATA" | jq '[.potential_pairs[]? | select(.confidence_score < 0.4)] | length' 2>/dev/null || echo "0")

echo ""
echo "Phase 1 Summary:"
echo "- High confidence pairs: $HIGH_CONFIDENCE"
echo "- Medium confidence pairs: $MEDIUM_CONFIDENCE"
echo "- Low confidence pairs: $LOW_CONFIDENCE"

# Ask if user wants to continue to Phase 2
echo ""
read -p "Continue to Phase 2 (deep analysis with bill text)? (y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Analysis stopped at Phase 1."
    exit 0
fi

# Phase 2: Deep dive analysis with bill text
echo ""
echo "=== PHASE 2: Deep dive analysis with bill text ==="
echo ""

# Create temp file for Phase 2 JSON
TEMP2_JSON=$(mktemp)

# Run Phase 2 - stderr shows progress, stdout to file
echo "Running Phase 2 analysis (this may take a while)..."
LEGISLATOR_NAME="$LEGISLATOR_NAME" \
    PHASE="2" \
    SELECTED_SESSION_ID="$SELECTED_SESSION_ID" \
    PAIRING_DATA="$PAIRING_DATA" \
    node scripts/gemini_chat_api_session.mjs > "$TEMP2_JSON"

# Read Phase 2 output
PHASE2_JSON=$(cat "$TEMP2_JSON")
rm -f "$TEMP2_JSON"

if [ $? -ne 0 ]; then
    echo "Error in Phase 2:"
    echo "$PHASE2_OUTPUT"
    exit 1
fi

# Extract and save Phase 2 output from the JSON response
PHASE2_RESPONSE=$(echo "$PHASE2_JSON" | jq -r '.response' 2>/dev/null)
if [ -z "$PHASE2_RESPONSE" ] || [ "$PHASE2_RESPONSE" = "null" ]; then
    echo "Error: Could not extract Phase 2 response"
    echo "Raw output: $PHASE2_JSON"
    exit 1
fi

# Clean up the response if it's wrapped in markdown code blocks (same as Phase 1)
if echo "$PHASE2_RESPONSE" | grep -q '```json'; then
    # Extract JSON from markdown code block using Python for cross-platform compatibility
    PHASE2_DATA=$(echo "$PHASE2_RESPONSE" | python3 -c "
import sys
data = sys.stdin.read()
start = data.find('{')
end = data.rfind('}') + 1
if start >= 0 and end > start:
    print(data[start:end])
")
else
    # Try to parse the response as JSON
    PHASE2_DATA=$(echo "$PHASE2_RESPONSE" | jq '.' 2>/dev/null || echo "$PHASE2_RESPONSE")
fi
echo "$PHASE2_DATA" > "${REPORT_DIR}/report.json"
echo "Phase 2 output saved to ${REPORT_DIR}/report.json"

# Create a human-readable report
cat > "${REPORT_DIR}/report.md" << EOF
# Investigation Report: ${LEGISLATOR_NAME}
## Session: ${SELECTED_SESSION_NAME}

### Summary
$(echo "$PHASE2_DATA" | jq -r '.session_summary')

### Key Findings
$(echo "$PHASE2_DATA" | jq -r '.key_findings[]' | while read -r finding; do echo "- $finding"; done)

### Confirmed Connections
$(echo "$PHASE2_DATA" | jq -r '.confirmed_connections[] | "
#### Bill: \(.bill_number) - \(.bill_title)
**Donors:** \(.donors[].name // .donors)
**Total Amount:** $\(.total_donor_amount)
**Vote:** \(.vote_value)
**Explanation:** \(.explanation)
**Confidence:** \(.confidence)
**Severity:** \(.severity)
"')

### Statistics
- Confirmed connections: $(echo "$PHASE2_DATA" | jq '.confirmed_connections | length')
- Rejected connections: $(echo "$PHASE2_DATA" | jq '.rejected_connections | length')

---
*Report generated on $(date)*
EOF

echo "Human-readable report saved to ${REPORT_DIR}/report.md"

# Display summary
echo ""
echo "=== FINAL ANALYSIS COMPLETE ==="
echo ""

CONFIRMED_COUNT=$(echo "$PHASE2_DATA" | jq '.confirmed_connections | length' 2>/dev/null || echo "0")
REJECTED_COUNT=$(echo "$PHASE2_DATA" | jq '.rejected_connections | length' 2>/dev/null || echo "0")

echo "Phase 2 Summary:"
echo "- Confirmed connections: $CONFIRMED_COUNT"
echo "- Rejected connections: $REJECTED_COUNT"
echo ""
echo "Session Summary:"
echo "$(echo "$PHASE2_DATA" | jq -r '.session_summary' 2>/dev/null || echo "No summary available")"
echo ""
echo "Key Findings:"
echo "$PHASE2_DATA" | jq -r '.key_findings[]' 2>/dev/null | while read -r finding; do
    echo "• $finding"
done || echo "No key findings available"

echo ""
echo "Full reports saved to:"
echo "- ${REPORT_DIR}/potential_pairings.json (Phase 1: all potential connections)"
echo "- ${REPORT_DIR}/report.json (Phase 2: validated connections)"
echo "- ${REPORT_DIR}/report.md (Human-readable report)"