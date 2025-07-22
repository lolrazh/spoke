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
clang -framework ApplicationServices -o "$DEST_DIR/sonic-helper" "$SOURCE_DIR/sonic-helper.c"
strip -x "$DEST_DIR/sonic-helper"
echo "sonic-helper compiled successfully."

echo "Native helper built successfully." 