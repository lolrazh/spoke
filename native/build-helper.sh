#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Define source and destination directories
SOURCE_DIR="native"
# Define the output directory for binaries
DEST_DIR="native/bin"

# Create the destination directories if they don't exist
mkdir -p "$DEST_DIR"

# --- sonic-helper ---
echo "Compiling sonic-helper..."
clang -framework ApplicationServices -framework IOKit -o "$DEST_DIR/sonic-helper" "$SOURCE_DIR/sonic-helper.c"

# Sign the helper with the same identity as the main app
echo "Signing sonic-helper..."
codesign --force --timestamp --options=runtime \
         --entitlements "$SOURCE_DIR/../build/entitlements/inherit.plist" \
         --sign "Apple Development: rajkumar.sandheep@gmail.com (8BJB99KGZ9)" \
         "$DEST_DIR/sonic-helper"

echo "sonic-helper compiled and signed successfully."

echo "Native helper built successfully." 