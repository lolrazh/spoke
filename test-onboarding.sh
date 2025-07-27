#!/bin/bash

echo "🧪 Testing Onboarding Flow"
echo "=========================="

# Get Cursor's bundle ID
CURSOR_BUNDLE_ID="com.todesktop.230313mzl4w4u92"

# Kill any existing processes
echo "1. Stopping any running Sonic Flow processes..."
pkill -f "sonic-flow" || true
sleep 1

# Remove the preferences file
echo "2. Clearing onboarding preferences..."
rm -f "/Users/lolrazh/Library/Application Support/Sonic Flow/app-preferences.json"

# Reset permissions ONLY for Cursor (so you can test in your IDE)
echo "3. Resetting permissions for Cursor only..."
echo "   This allows you to test permission flows without affecting other apps"

# Reset microphone for Cursor
sudo tccutil reset Microphone $CURSOR_BUNDLE_ID 2>/dev/null || echo "   ⚠️  Could not reset microphone for Cursor"

# Reset accessibility for Cursor  
sudo tccutil reset Accessibility $CURSOR_BUNDLE_ID 2>/dev/null || echo "   ⚠️  Could not reset accessibility for Cursor"

# Reset input monitoring (this affects system-wide, but necessary for testing)
echo "   📝 Note: Input Monitoring reset affects system-wide (macOS limitation)"

# Start with onboarding flag
echo "4. Starting Sonic Flow with onboarding flag..."
echo "   (This will ALWAYS show onboarding, even after completing it)"
echo ""
echo "💡 TIP: If permissions fail, the app will show deep-links to System Preferences!"
echo ""

SF_DEV_ONBOARDING=1 npm start