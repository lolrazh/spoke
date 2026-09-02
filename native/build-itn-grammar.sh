#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS_DIR="${SPOKE_ITN_DEPS_DIR:-$ROOT_DIR/.deps/itn}"
NEMO_TEXT_DIR="${SPOKE_ITN_NEMO_TEXT_DIR:-$DEPS_DIR/nemo-text-processing}"
OUTPUT_DIR="${SPOKE_ITN_GRAMMAR_DIR:-$ROOT_DIR/native/bin/itn-grammars/en-US}"
PYTHON="${SPOKE_ITN_PYTHON:-python3}"
NEMO_TEXT_REPO="https://github.com/NVIDIA/NeMo-text-processing.git"
NEMO_TEXT_COMMIT="acacc21b1cb7916b10558855bc4f85957a0b2fde"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to build the NeMo ITN grammar" >&2
  exit 1
fi

mkdir -p "$DEPS_DIR"

if [[ ! -d "$NEMO_TEXT_DIR/.git" ]]; then
  git clone --filter=blob:none --no-checkout "$NEMO_TEXT_REPO" "$NEMO_TEXT_DIR"
fi
git -C "$NEMO_TEXT_DIR" fetch --quiet origin "$NEMO_TEXT_COMMIT"
git -C "$NEMO_TEXT_DIR" checkout --quiet --detach "$NEMO_TEXT_COMMIT"

NEMO_PYTHONPATH="$NEMO_TEXT_DIR${PYTHONPATH:+:$PYTHONPATH}"

if ! PYTHONPATH="$NEMO_PYTHONPATH" "$PYTHON" -c "import pynini" >/dev/null 2>&1; then
  echo "Pynini is missing from $PYTHON. Set SPOKE_ITN_PYTHON to the grammar-build environment." >&2
  exit 1
fi

if ! PYTHONPATH="$NEMO_PYTHONPATH" "$PYTHON" -c "import nemo_text_processing" >/dev/null 2>&1; then
  echo "nemo_text_processing is missing from $PYTHON. Run the exporter from its pinned checkout or install the package." >&2
  exit 1
fi

GENERATED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spoke-itn-grammar.XXXXXX")"
cleanup() {
  rm -rf "$GENERATED_DIR"
}
trap cleanup EXIT

echo "Exporting NeMo English ITN grammars from $NEMO_TEXT_COMMIT..."
(
  cd "$NEMO_TEXT_DIR"
  PYTHONPATH="$NEMO_PYTHONPATH" \
    "$PYTHON" tools/text_processing_deployment/pynini_export.py \
      --output_dir "$GENERATED_DIR" \
      --language en \
      --grammars itn_grammars \
      --input_case cased \
      --overwrite_cache
)

SOURCE_DIR="$GENERATED_DIR/en_itn_grammars_cased"
if [[ ! -f "$SOURCE_DIR/classify/tokenize_and_classify.far" ]]; then
  echo "NeMo exporter did not produce tokenize_and_classify.far" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_DIR/verbalize/verbalize.far" ]]; then
  echo "NeMo exporter did not produce verbalize.far" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
install -m 0644 "$SOURCE_DIR/classify/tokenize_and_classify.far" \
  "$OUTPUT_DIR/tokenize_and_classify.far"
install -m 0644 "$SOURCE_DIR/verbalize/verbalize.far" \
  "$OUTPUT_DIR/verbalize.far"

echo "NeMo ITN grammars written to $OUTPUT_DIR"
