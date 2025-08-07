#!/bin/bash

echo "🚀 Starting Sonic Flow in Development Mode with Enhanced Features"
echo "=================================================================="

# Enhanced development environment variables
export NODE_ENV=development
export SF_DEV_ONBOARDING=1
export SF_DEV_SKIP_PERMISSIONS=true
export SF_DEV_MOCK_PERMS=true
export SF_DEV_DEBUG=true
export SF_DEV_FAST_ANIMS=true
export SF_DESIGN_MODE=1
export SF_SHOW_DEV_INDICATOR=true

# Mock permission states for testing different scenarios
export SF_MOCK_MIC_STATE=granted    # granted, denied, prompt
export SF_MOCK_AX_STATE=granted     # granted, denied, prompt  
export SF_MOCK_IM_STATE=granted     # granted, denied, prompt

echo "🎛️  Development Mode Features:"
echo "   • Mock Permissions: ON (no system dialogs)"
echo "   • Debug Overlay: ON (shows state in UI)"  
echo "   • Fast Animations: ON (10x speed)"
echo "   • Design Mode: ON (all dev features)"
echo ""
echo "🧪 Mock Permission States:"
echo "   • Microphone: $SF_MOCK_MIC_STATE"
echo "   • Accessibility: $SF_MOCK_AX_STATE"
echo "   • Input Monitoring: $SF_MOCK_IM_STATE"
echo ""
echo "💡 Pro Tips:"
echo "   • Use the debug panel (top-right) to reset permissions"
echo "   • Open DevTools to access window.mockPermissions helpers"
echo "   • Change mock states by editing this script"
echo ""

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."
pkill -f "sonic-flow" || true
sleep 1

# Clear preferences for fresh onboarding
echo "🗑️  Clearing onboarding preferences..."
rm -f "/Users/$(whoami)/Library/Application Support/Sonic Flow/app-preferences.json" 2>/dev/null || true

echo "🎬 Starting development server..."
npm start