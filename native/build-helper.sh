#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Define source and destination directories
SOURCE_DIR="native"
DEST_DIR="native/bin"
APP_BUNDLE_NAME="SonicFlowHelper.app"
APP_BUNDLE_PATH="$DEST_DIR/$APP_BUNDLE_NAME"
EXECUTABLE_NAME="SonicFlowHelper"

# Clean up previous build
echo "Cleaning up old build artifacts..."
rm -rf "$APP_BUNDLE_PATH"
rm -f "$DEST_DIR/sonic-helper" # Remove old naked binary

# Create the directory structure for the .app bundle
echo "Creating .app bundle structure at $APP_BUNDLE_PATH..."
mkdir -p "$APP_BUNDLE_PATH/Contents/MacOS"
mkdir -p "$APP_BUNDLE_PATH/Contents/Resources"

# --- Compile the executable ---
echo "Compiling $EXECUTABLE_NAME..."
clang -framework ApplicationServices -framework IOKit \
      -o "$APP_BUNDLE_PATH/Contents/MacOS/$EXECUTABLE_NAME" \
      "$SOURCE_DIR/sonic-helper.c"

# --- Copy Info.plist ---
echo "Copying Info.plist..."
cp "$SOURCE_DIR/Info.plist" "$APP_BUNDLE_PATH/Contents/Info.plist"

# --- Update Info.plist ---
# Use PlistBuddy to ensure the executable name is correct in the plist
echo "Updating CFBundleExecutable in Info.plist..."
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $EXECUTABLE_NAME" "$APP_BUNDLE_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $EXECUTABLE_NAME" "$APP_BUNDLE_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.sonicflow.helper" "$APP_BUNDLE_PATH/Contents/Info.plist"


# --- Sign the .app bundle ---
echo "Signing $APP_BUNDLE_NAME..."
codesign --force --timestamp --options=runtime \
         --entitlements "$SOURCE_DIR/../build/entitlements/inherit.plist" \
         --sign "Apple Development: rajkumar.sandheep@gmail.com (8BJB99KGZ9)" \
         "$APP_BUNDLE_PATH"

echo "$APP_BUNDLE_NAME built and signed successfully."
echo "Native helper built successfully at $APP_BUNDLE_PATH"
