#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Define source and destination directories
SOURCE_DIR="native"
# Define the output directory for binaries
DEST_DIR="native/bin"
PUBLIC_ASSETS_DIR="public/assets"

# Create the destination directories if they don't exist
mkdir -p "$DEST_DIR"
mkdir -p "$PUBLIC_ASSETS_DIR"

# --- fn-tap ---
echo "Compiling fn-tap..."
clang -framework Carbon -o "$DEST_DIR/fn-tap" "$SOURCE_DIR/fn-tap.c"
strip -x "$DEST_DIR/fn-tap"
echo "fn-tap compiled successfully."

# --- paste-helper ---
echo "Compiling paste-helper..."
clang -framework ApplicationServices -o "$DEST_DIR/paste-helper" "$SOURCE_DIR/paste-helper.c"
strip -x "$DEST_DIR/paste-helper"
echo "paste-helper compiled successfully."

echo "Native helpers built successfully." 