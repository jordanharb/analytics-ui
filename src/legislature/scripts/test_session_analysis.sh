#!/bin/bash

# Test script for session-specific analysis
# This demonstrates how to run each phase independently

LEGISLATOR="Daniel Hernandez"

echo "Testing session-specific analysis for: $LEGISLATOR"
echo ""

# Test Phase 1 only (will prompt for session selection)
echo "Running Phase 1 (Pairing Generation)..."
echo ""
echo "Command: LEGISLATOR_NAME=\"$LEGISLATOR\" IS_INITIAL=\"true\" PHASE=\"1\" node scripts/gemini_chat_api_session.mjs"
echo ""

# For automated testing, you can also provide a specific session:
# LEGISLATOR_NAME="$LEGISLATOR" IS_INITIAL="true" PHASE="1" SELECTED_SESSION_ID="125" node scripts/gemini_chat_api_session.mjs

# For Phase 2, you need to provide the pairing data from Phase 1:
# PAIRING_DATA=$(cat phase1_output.json)
# LEGISLATOR_NAME="$LEGISLATOR" PHASE="2" SELECTED_SESSION_ID="125" PAIRING_DATA="$PAIRING_DATA" node scripts/gemini_chat_api_session.mjs