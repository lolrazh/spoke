#!/usr/bin/env bash
# Build the MLX Whisper sidecar as a macOS arm64 PyInstaller onedir bundle.
# Output: local-stt/dist-ondir/spoke-stt/spoke-stt
#
# This is an experiment target. Production currently uses build-sidecar.sh,
# which emits a single-file binary at local-stt/dist/spoke-stt.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".venv/bin/python" ]; then
  echo "Error: Python venv not found at .venv/bin/python"
  echo "Run: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt pyinstaller"
  exit 1
fi

source .venv/bin/activate

if ! command -v pyinstaller &>/dev/null; then
  echo "Installing PyInstaller..."
  pip install pyinstaller
fi

echo "Building spoke-stt onedir sidecar bundle..."
rm -rf build/onedir dist-ondir

pyinstaller \
  --onedir \
  --name spoke-stt \
  --specpath build/onedir \
  --workpath build/onedir \
  --distpath dist-ondir \
  --target-arch arm64 \
  --strip \
  --noupx \
  --console \
  --collect-all mlx \
  --collect-all mlx_speech \
  --collect-all tokenizers \
  --collect-all parakeet_mlx \
  --collect-data mlx_whisper \
  --collect-submodules tiktoken_ext \
  --exclude-module torch \
  --exclude-module torchvision \
  --exclude-module torchaudio \
  --exclude-module tensorflow \
  --exclude-module scipy \
  --exclude-module numba \
  --exclude-module llvmlite \
  --exclude-module librosa \
  --hidden-import mlx \
  --hidden-import mlx.core \
  --hidden-import mlx.nn \
  --hidden-import numpy \
  --hidden-import huggingface_hub \
  --hidden-import mlx_whisper.audio \
  --hidden-import mlx_whisper.decoding \
  --hidden-import mlx_whisper.load_models \
  --hidden-import mlx_whisper.tokenizer \
  --hidden-import mlx_whisper.whisper \
  --hidden-import tiktoken \
  --hidden-import tiktoken_ext.openai_public \
  sidecar.py

echo ""
if [ -f "dist-ondir/spoke-stt/spoke-stt" ]; then
  SIZE=$(du -sh dist-ondir/spoke-stt | cut -f1)
  echo "Build successful: dist-ondir/spoke-stt ($SIZE)"
  echo ""
  echo "Test with:"
  echo "  ./dist-ondir/spoke-stt/spoke-stt --weights-dir ./weights"
else
  echo "Build failed: dist-ondir/spoke-stt/spoke-stt not found"
  exit 1
fi
