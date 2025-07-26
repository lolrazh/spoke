#!/bin/bash

echo "🧪 Testing Onboarding Flow"
echo "=========================="

# Kill any existing processes
echo "1. Stopping any running Sonic Flow processes..."
pkill -f "sonic-flow" || true
sleep 1

# Remove the preferences file
echo "2. Clearing onboarding preferences..."
rm -f "/Users/lolrazh/Library/Application Support/Sonic Flow/app-preferences.json"

# Start with onboarding flag
echo "3. Starting Sonic Flow with onboarding flag..."
echo "   (This will ALWAYS show onboarding, even after completing it)"
SF_DEV_ONBOARDING=1 npm start