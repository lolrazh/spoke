#!/usr/bin/env bash
set -euo pipefail

# Safely detach the DMG volume if mounted
hdiutil detach "/Volumes/Spoke" 2>/dev/null || true

# Clean build artifacts only
npm run clean

# Rebuild DMG with verbose + debug logs, capturing to file
LOG_DIR="out/make"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/forge-make-$(date +%Y%m%d_%H%M%S).log"
echo "[clean-dmg] Starting electron-forge make (logging to $LOG_FILE)"

# Always enable DEBUG namespaces; harmless if APPLE_NOTARIZE=0
# Use the npm script so node_modules/.bin is on PATH and .env is loaded
DEBUG="electron-forge:*,electron-osx-sign:*,@electron/osx-sign:*,electron-notarize:*" \
  npm run --silent make:env -- --verbose 2>&1 | tee "$LOG_FILE"

# Open the newly created DMG (best-effort)
DMG_PATH="out/make/Spoke-0.0.1-arm64.dmg"
if [[ -f "$DMG_PATH" ]]; then
  open "$DMG_PATH"
else
  # Fallback: open the newest DMG under out/make
  LATEST_DMG=$(ls -t out/make/**/*.dmg out/make/*.dmg 2>/dev/null | head -n1 || true)
  if [[ -n "$LATEST_DMG" ]]; then
    echo "[clean-dmg] Opening latest DMG: $LATEST_DMG"
    open "$LATEST_DMG"
  else
    echo "[clean-dmg] No DMG found to open."
  fi
fi
