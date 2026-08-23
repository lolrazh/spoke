#!/usr/bin/env bash
# Build the MLX Whisper sidecar as a standalone macOS arm64 binary using PyInstaller.
# Output: local-stt/dist/spoke-stt
#
# Prerequisites:
#   cd local-stt
#   python -m venv .venv
#   source .venv/bin/activate
#   pip install -r requirements.txt
#   pip install pyinstaller

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure venv exists
if [ ! -f ".venv/bin/python" ]; then
  echo "Error: Python venv not found at .venv/bin/python"
  echo "Run: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt pyinstaller"
  exit 1
fi

# Activate venv
source .venv/bin/activate

# Ensure PyInstaller is installed
if ! command -v pyinstaller &>/dev/null; then
  echo "Installing PyInstaller..."
  pip install pyinstaller
fi

echo "Building spoke-stt sidecar binary..."
rm -rf build dist

pyinstaller \
  --onefile \
  --name spoke-stt \
  --specpath build \
  --workpath build \
  --distpath dist \
  --target-arch arm64 \
  --strip \
  --noupx \
  --console \
  --collect-all mlx \
  --collect-data mlx_whisper \
  --collect-submodules tiktoken_ext \
  --exclude-module torch \
  --exclude-module torchvision \
  --exclude-module torchaudio \
  --exclude-module tensorflow \
  --exclude-module scipy \
  --exclude-module numba \
  --exclude-module llvmlite \
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
  --hidden-import nemotron_streaming \
  --hidden-import mlx_audio.stt.models.nemotron_asr \
  --hidden-import tiktoken \
  --hidden-import tiktoken_ext.openai_public \
  sidecar.py

echo ""
if [ -f "dist/spoke-stt" ]; then
  SIZE=$(du -h dist/spoke-stt | cut -f1)
  echo "Build successful: dist/spoke-stt ($SIZE)"
  echo ""
  echo "Test with:"
  echo "  ./dist/spoke-stt --weights-dir ./weights"
  echo "  (should emit {\"type\":\"ready\"} on stdout)"
else
  echo "Build failed: dist/spoke-stt not found"
  exit 1
fi
