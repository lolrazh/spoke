#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "APPLE_TEAM_ID is required for release preflight" >&2
  exit 1
fi

APP_PATH="out/Spoke-darwin-arm64/Spoke.app"

npx vitest run src/main/updateController.test.ts
npx tsc --noEmit
electron-forge package --arch=arm64

if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected packaged app at $APP_PATH" >&2
  exit 1
fi

TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :ElectronTeamID' "$APP_PATH/Contents/Info.plist")"
if [[ "$TEAM_ID" != "$APPLE_TEAM_ID" ]]; then
  echo "ElectronTeamID mismatch: expected $APPLE_TEAM_ID, got $TEAM_ID" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
PLIST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist")"
if [[ "$PLIST_VERSION" != "$VERSION" ]]; then
  echo "Version mismatch: package.json=$VERSION Info.plist=$PLIST_VERSION" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
SIGNATURE_DETAILS="$(codesign -dv --verbose=2 "$APP_PATH" 2>&1)"
if [[ "$SIGNATURE_DETAILS" != *"TeamIdentifier=$APPLE_TEAM_ID"* ]]; then
  echo "codesign TeamIdentifier mismatch" >&2
  echo "$SIGNATURE_DETAILS" >&2
  exit 1
fi

echo "Release preflight passed for $APP_PATH"
