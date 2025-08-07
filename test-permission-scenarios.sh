#!/bin/bash

echo "🧪 Sonic Flow Permission Scenario Tester"
echo "========================================"

case "${1:-help}" in
  "all-granted")
    echo "🟢 Testing: All Permissions Granted"
    export SF_MOCK_MIC_STATE=granted
    export SF_MOCK_AX_STATE=granted  
    export SF_MOCK_IM_STATE=granted
    ;;
    
  "all-denied")
    echo "🔴 Testing: All Permissions Denied"
    export SF_MOCK_MIC_STATE=denied
    export SF_MOCK_AX_STATE=denied
    export SF_MOCK_IM_STATE=denied
    ;;
    
  "partial")
    echo "🟡 Testing: Partial Permissions (Mic granted, others denied)"
    export SF_MOCK_MIC_STATE=granted
    export SF_MOCK_AX_STATE=denied
    export SF_MOCK_IM_STATE=denied
    ;;
    
  "prompt")
    echo "🔵 Testing: Fresh Install (All prompts required)"
    export SF_MOCK_MIC_STATE=prompt
    export SF_MOCK_AX_STATE=prompt
    export SF_MOCK_IM_STATE=prompt
    ;;
    
  "real")
    echo "🎯 Testing: Real Permissions (No Mocks)"
    export SF_DEV_MOCK_PERMS=false
    export SF_DEV_SKIP_PERMISSIONS=false
    echo "   Warning: This will trigger real system dialogs!"
    ;;
    
  *)
    echo "Usage: $0 [scenario]"
    echo ""
    echo "Available scenarios:"
    echo "  all-granted  - All permissions already granted"
    echo "  all-denied   - All permissions denied (error states)"
    echo "  partial      - Mixed permission states"
    echo "  prompt       - Fresh install experience"
    echo "  real         - Use real system APIs (no mocks)"
    echo ""
    echo "Example: ./test-permission-scenarios.sh partial"
    exit 1
    ;;
esac

# Set common dev flags
export NODE_ENV=development
export SF_DEV_ONBOARDING=1
export SF_DEV_MOCK_PERMS=true
export SF_DEV_DEBUG=true
export SF_DEV_FAST_ANIMS=true
export SF_DESIGN_MODE=1

echo "🎬 Starting with scenario: ${1}"
echo ""

# Clean up and start
pkill -f "sonic-flow" || true
rm -f "/Users/$(whoami)/Library/Application Support/Sonic Flow/app-preferences.json" 2>/dev/null || true
npm start