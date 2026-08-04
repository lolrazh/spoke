#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Define source and destination directories
SOURCE_DIR="native"
DEST_DIR="native/bin"
APP_BUNDLE_NAME="Spoke Helper.app"
APP_BUNDLE_PATH="$DEST_DIR/$APP_BUNDLE_NAME"
EXECUTABLE_NAME="Spoke Helper"

# Clean up previous build
echo "Cleaning up old build artifacts..."
rm -rf "$APP_BUNDLE_PATH"
rm -f "$DEST_DIR/spoke-helper" # Remove old naked binary

# Create the directory structure for the .app bundle
echo "Creating .app bundle structure at $APP_BUNDLE_PATH..."
mkdir -p "$APP_BUNDLE_PATH/Contents/MacOS"
mkdir -p "$APP_BUNDLE_PATH/Contents/Resources"

# --- Compile the executable ---
echo "Compiling $EXECUTABLE_NAME (Objective-C with AX support)..."
clang -x objective-c -fobjc-arc \
      -framework Foundation -framework AppKit \
      -framework ApplicationServices -framework IOKit -framework CoreGraphics \
      -o "$APP_BUNDLE_PATH/Contents/MacOS/$EXECUTABLE_NAME" \
      "$SOURCE_DIR/spoke-helper.c"

# Ensure the binary is executable
chmod +x "$APP_BUNDLE_PATH/Contents/MacOS/$EXECUTABLE_NAME"

# --- Copy Info.plist ---
echo "Copying Info.plist..."
cp "$SOURCE_DIR/Info.plist" "$APP_BUNDLE_PATH/Contents/Info.plist"

# --- Update Info.plist ---
# Use PlistBuddy to ensure the executable name is correct in the plist
echo "Updating CFBundleExecutable in Info.plist..."
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $EXECUTABLE_NAME" "$APP_BUNDLE_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $EXECUTABLE_NAME" "$APP_BUNDLE_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.spoke.app.helper" "$APP_BUNDLE_PATH/Contents/Info.plist"

echo "$APP_BUNDLE_NAME built (unsigned). Will be signed by Forge."
echo "Native helper built successfully at $APP_BUNDLE_PATH"

# --- Compile notch reporter ---
NOTCH_EXECUTABLE_NAME="notch-reporter"
NOTCH_SOURCE_FILE="$SOURCE_DIR/notch-reporter.swift"
NOTCH_OUTPUT_PATH="$DEST_DIR/$NOTCH_EXECUTABLE_NAME"

if [ -f "$NOTCH_SOURCE_FILE" ]; then
  if ! command -v swiftc >/dev/null 2>&1; then
    echo "Warning: swiftc not found. Skipping notch reporter build. Install Xcode Command Line Tools to enable this step." >&2
  else
    echo "Compiling $NOTCH_EXECUTABLE_NAME (Swift notch reporter)..."
    swiftc -O -parse-as-library -target arm64-apple-macos13 \
      -o "$NOTCH_OUTPUT_PATH" \
      "$NOTCH_SOURCE_FILE"

    chmod +x "$NOTCH_OUTPUT_PATH"
    echo "$NOTCH_EXECUTABLE_NAME built successfully at $NOTCH_OUTPUT_PATH (will be signed by Forge)"
  fi
fi

# --- Compile native audio capture helper ---
AUDIO_EXECUTABLE_NAME="Spoke Audio Capture"
AUDIO_SOURCE_FILE="$SOURCE_DIR/audio-capture.swift"
AUDIO_APP_NAME="Spoke Audio Capture.app"
AUDIO_APP_PATH="$DEST_DIR/$AUDIO_APP_NAME"
AUDIO_EXECUTABLE_PATH="$AUDIO_APP_PATH/Contents/MacOS/$AUDIO_EXECUTABLE_NAME"
AUDIO_INFO_PLIST="$SOURCE_DIR/AudioCaptureInfo.plist"

rm -rf "$AUDIO_APP_PATH"

if [ -f "$AUDIO_SOURCE_FILE" ]; then
  if ! command -v swiftc >/dev/null 2>&1; then
    echo "Warning: swiftc not found. Skipping native audio capture build." >&2
  else
    echo "Compiling $AUDIO_EXECUTABLE_NAME (AVAudioEngine + AVAudioConverter)..."
    mkdir -p "$AUDIO_APP_PATH/Contents/MacOS" "$AUDIO_APP_PATH/Contents/Resources"
    swiftc -O -parse-as-library -target arm64-apple-macos13 \
      -framework AVFAudio -framework CoreAudio \
      -o "$AUDIO_EXECUTABLE_PATH" \
      "$AUDIO_SOURCE_FILE"
    cp "$AUDIO_INFO_PLIST" "$AUDIO_APP_PATH/Contents/Info.plist"
    chmod +x "$AUDIO_EXECUTABLE_PATH"
    echo "$AUDIO_APP_NAME built successfully at $AUDIO_APP_PATH (will be signed by Forge)"
  fi
fi
