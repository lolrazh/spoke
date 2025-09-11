#!/usr/bin/env bash
set -euo pipefail

# Safely detach the DMG volume if mounted
hdiutil detach "/Volumes/Sonic Flow" 2>/dev/null || true

# Clean build artifacts only
npm run clean

# Rebuild DMG
npm run make:env

# Open the newly created DMG
open out/make/Sonic\ Flow-0.0.1-arm64.dmg