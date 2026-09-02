#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS_DIR="${SPOKE_ITN_DEPS_DIR:-$ROOT_DIR/.deps/itn}"
NATIVE_BUILD_DIR="$DEPS_DIR/native"
SPARROWHAWK_DIR="$NATIVE_BUILD_DIR/sparrowhawk"
RE2_DIR="$NATIVE_BUILD_DIR/re2"
NEMO_SPEECH_DIR="$NATIVE_BUILD_DIR/nemo-speech.cpp"
SPARROWHAWK_PREFIX="$NATIVE_BUILD_DIR/sparrowhawk-prefix"
NEMO_SPEECH_REPO="https://github.com/NVIDIA/NeMo-Speech.cpp.git"
NEMO_SPEECH_COMMIT="56b60d432f1731d6d5b28a4c5a31cbaf871daba1"
SPARROWHAWK_REPO="https://github.com/google/sparrowhawk.git"
SPARROWHAWK_COMMIT="8b082acc507312077a096be8398584a13832c490"
RE2_REPO="https://github.com/google/re2.git"
RE2_COMMIT="4be240789d5b322df9f02b7e19c8651f3ccbf205"
COMPAT_DIR="$ROOT_DIR/native/itn/compat"
PATCH_FILE="$ROOT_DIR/native/itn/sparrowhawk-macos.patch"
OUTPUT_DIR="$ROOT_DIR/native/bin"
LIB_OUTPUT_DIR="$OUTPUT_DIR/itn-libs"
OUTPUT_BINARY="$OUTPUT_DIR/spoke-itn"
BUILD_JOBS="${SPOKE_ITN_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
CC_COMPILER="${CC:-clang}"
CXX_COMPILER="${CXX:-clang++}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The Spoke ITN helper currently builds on macOS only" >&2
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install openfst and protobuf@21 first." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "git is required to build the Spoke ITN helper" >&2
  exit 1
fi

brew_prefix() {
  local formula="$1"
  local prefix
  if ! prefix="$(brew --prefix "$formula" 2>/dev/null)"; then
    echo "Homebrew formula $formula is missing. Run: brew install $formula" >&2
    exit 1
  fi
  echo "$prefix"
}

OPENFST_PREFIX="${SPOKE_ITN_OPENFST_PREFIX:-$(brew_prefix openfst)}"
PROTOBUF_PREFIX="${SPOKE_ITN_PROTOBUF_PREFIX:-$(brew_prefix protobuf@21)}"
PROTOC="$PROTOBUF_PREFIX/bin/protoc"

for required_path in \
  "$OPENFST_PREFIX/include/fst/fst.h" \
  "$OPENFST_PREFIX/include/fst/extensions/far/far.h" \
  "$OPENFST_PREFIX/include/fst/extensions/pdt/pdt.h" \
  "$PROTOBUF_PREFIX/include/google/protobuf/message.h" \
  "$PROTOC" \
  "$COMPAT_DIR/sparrowhawk_compat.h"; do
  if [[ ! -e "$required_path" ]]; then
    echo "Required ITN build file is missing: $required_path" >&2
    exit 1
  fi
done

ensure_checkout() {
  local repo="$1"
  local commit="$2"
  local directory="$3"
  if [[ ! -d "$directory/.git" ]]; then
    git clone --filter=blob:none --no-checkout "$repo" "$directory"
  fi
  git -C "$directory" fetch --quiet origin "$commit"
  git -C "$directory" checkout --quiet --detach "$commit"
}

mkdir -p "$NATIVE_BUILD_DIR"
ensure_checkout "$NEMO_SPEECH_REPO" "$NEMO_SPEECH_COMMIT" "$NEMO_SPEECH_DIR"
ensure_checkout "$SPARROWHAWK_REPO" "$SPARROWHAWK_COMMIT" "$SPARROWHAWK_DIR"
ensure_checkout "$RE2_REPO" "$RE2_COMMIT" "$RE2_DIR"

if git -C "$SPARROWHAWK_DIR" apply --unidiff-zero --check "$PATCH_FILE" >/dev/null 2>&1; then
  git -C "$SPARROWHAWK_DIR" apply --unidiff-zero "$PATCH_FILE"
elif ! git -C "$SPARROWHAWK_DIR" apply --unidiff-zero --reverse --check "$PATCH_FILE" >/dev/null 2>&1; then
  echo "Sparrowhawk is not at a clean compatible revision" >&2
  exit 1
fi

echo "Building RE2 $RE2_COMMIT..."
make -C "$RE2_DIR" -j"$BUILD_JOBS" \
  CXX="$CXX_COMPILER" \
  CXXFLAGS="-O2 -fPIC" \
  obj/libre2.a

echo "Building Sparrowhawk $SPARROWHAWK_COMMIT..."
make -C "$SPARROWHAWK_DIR" distclean >/dev/null 2>&1 || true
(
  cd "$SPARROWHAWK_DIR/src/proto"
  for proto_file in *.proto; do
    "$PROTOC" --proto_path=. --cpp_out=. "$proto_file"
  done
  cp ./*.pb.cc ../lib/
  cp ./*.pb.h ../include/sparrowhawk/
)
(
  cd "$SPARROWHAWK_DIR"
  PATH="$PROTOBUF_PREFIX/bin:$PATH" \
    CC="$CC_COMPILER" \
    CXX="$CXX_COMPILER" \
    CPPFLAGS="-I$COMPAT_DIR -I$OPENFST_PREFIX/include -I$PROTOBUF_PREFIX/include -I$RE2_DIR" \
    CXXFLAGS="-std=c++17 -O2 -funsigned-char -include $COMPAT_DIR/sparrowhawk_compat.h" \
    LDFLAGS="-L$OPENFST_PREFIX/lib -L$PROTOBUF_PREFIX/lib -L$RE2_DIR/obj" \
    ./configure CXX="$CXX_COMPILER" \
      --prefix="$SPARROWHAWK_PREFIX" \
      --disable-bin \
      --disable-static \
      --enable-shared
)
make -C "$SPARROWHAWK_DIR" -j"$BUILD_JOBS"
make -C "$SPARROWHAWK_DIR" install
mkdir -p "$SPARROWHAWK_PREFIX/include/sparrowhawk"
cp "$SPARROWHAWK_DIR/src/include/sparrowhawk/"*.pb.h \
  "$SPARROWHAWK_PREFIX/include/sparrowhawk/"

SPARROWHAWK_LIBRARY="$SPARROWHAWK_PREFIX/lib/libsparrowhawk.0.dylib"
if [[ ! -f "$SPARROWHAWK_LIBRARY" ]]; then
  echo "Sparrowhawk did not produce $SPARROWHAWK_LIBRARY" >&2
  exit 1
fi

echo "Linking the persistent Spoke ITN helper..."
mkdir -p "$OUTPUT_DIR" "$LIB_OUTPUT_DIR"
"$CXX_COMPILER" -std=c++17 -O2 -funsigned-char \
  -I"$COMPAT_DIR" \
  -I"$SPARROWHAWK_PREFIX/include" \
  -I"$OPENFST_PREFIX/include" \
  -I"$PROTOBUF_PREFIX/include" \
  -I"$RE2_DIR" \
  -I"$NEMO_SPEECH_DIR/src/common/text_normalization" \
  -include "$COMPAT_DIR/sparrowhawk_compat.h" \
  "$ROOT_DIR/native/itn/spoke-itn.cpp" \
  "$NEMO_SPEECH_DIR/src/common/text_normalization/fst_normalizer.cpp" \
  -L"$SPARROWHAWK_PREFIX/lib" -lsparrowhawk \
  -L"$OPENFST_PREFIX/lib" -lfstfar -lfst \
  "-Wl,-force_load,$RE2_DIR/obj/libre2.a" \
  "-Wl,-force_load,$PROTOBUF_PREFIX/lib/libprotobuf.a" \
  -lz -liconv \
  -Wl,-rpath,@loader_path/itn-libs \
  -o "$OUTPUT_BINARY"

OPENFST_FST_LIBRARY=""
OPENFST_FAR_LIBRARY=""
for candidate in "$OPENFST_PREFIX"/lib/libfst.[0-9]*.dylib; do
  [[ -f "$candidate" ]] || continue
  OPENFST_FST_LIBRARY="$candidate"
  break
done
for candidate in "$OPENFST_PREFIX"/lib/libfstfar.[0-9]*.dylib; do
  [[ -f "$candidate" ]] || continue
  OPENFST_FAR_LIBRARY="$candidate"
  break
done
if [[ -z "$OPENFST_FST_LIBRARY" || -z "$OPENFST_FAR_LIBRARY" ]]; then
  echo "Could not locate the OpenFST runtime libraries under $OPENFST_PREFIX/lib" >&2
  exit 1
fi

SPARROWHAWK_NAME="$(basename "$SPARROWHAWK_LIBRARY")"
FST_NAME="$(basename "$OPENFST_FST_LIBRARY")"
FAR_NAME="$(basename "$OPENFST_FAR_LIBRARY")"
FST_DEPENDENCY_ID="$(otool -L "$OPENFST_FAR_LIBRARY" | awk '/libfst\.[0-9]+\.dylib/ { sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+\(.*/, ""); print; exit }')"
if [[ -z "$FST_DEPENDENCY_ID" ]]; then
  echo "Could not find libfst dependency recorded by $OPENFST_FAR_LIBRARY" >&2
  exit 1
fi
install -m 0755 "$SPARROWHAWK_LIBRARY" "$LIB_OUTPUT_DIR/$SPARROWHAWK_NAME"
install -m 0755 "$OPENFST_FST_LIBRARY" "$LIB_OUTPUT_DIR/$FST_NAME"
install -m 0755 "$OPENFST_FAR_LIBRARY" "$LIB_OUTPUT_DIR/$FAR_NAME"

install_name_tool -id "@rpath/$SPARROWHAWK_NAME" "$LIB_OUTPUT_DIR/$SPARROWHAWK_NAME"
install_name_tool -id "@rpath/$FST_NAME" "$LIB_OUTPUT_DIR/$FST_NAME"
install_name_tool -id "@rpath/$FAR_NAME" "$LIB_OUTPUT_DIR/$FAR_NAME"
install_name_tool -change "$SPARROWHAWK_LIBRARY" \
  "@rpath/$SPARROWHAWK_NAME" "$OUTPUT_BINARY"
install_name_tool -change "$OPENFST_FST_LIBRARY" \
  "@rpath/$FST_NAME" "$OUTPUT_BINARY" 2>/dev/null || true
install_name_tool -change "$OPENFST_FAR_LIBRARY" \
  "@rpath/$FAR_NAME" "$OUTPUT_BINARY" 2>/dev/null || true
install_name_tool -change "$FST_DEPENDENCY_ID" \
  "@rpath/$FST_NAME" "$LIB_OUTPUT_DIR/$FAR_NAME"

# install_name_tool invalidates Homebrew's existing signatures. Add a local
# ad-hoc signature so the helper can run in development; Forge replaces these
# signatures with the release identity when it packages the app.
codesign --force --sign - "$LIB_OUTPUT_DIR/$SPARROWHAWK_NAME" \
  "$LIB_OUTPUT_DIR/$FST_NAME" "$LIB_OUTPUT_DIR/$FAR_NAME" >/dev/null

chmod +x "$OUTPUT_BINARY"
if ! file "$OUTPUT_BINARY" | rg -q 'arm64'; then
  echo "The ITN helper is not an arm64 binary" >&2
  exit 1
fi

RUNTIME_LINKS="$(otool -L "$OUTPUT_BINARY")"
if [[ "$RUNTIME_LINKS" == *"/opt/homebrew/"* || "$RUNTIME_LINKS" == *"$SPARROWHAWK_PREFIX"* ]]; then
  echo "The ITN helper still has a build-machine library path:" >&2
  echo "$RUNTIME_LINKS" >&2
  exit 1
fi
for runtime_library in "$LIB_OUTPUT_DIR"/*.dylib; do
  runtime_links="$(otool -L "$runtime_library")"
  if [[ "$runtime_links" == *"/opt/homebrew/"* || "$runtime_links" == *"$SPARROWHAWK_PREFIX"* ]]; then
    echo "Bundled ITN library still has a build-machine path: $runtime_library" >&2
    echo "$runtime_links" >&2
    exit 1
  fi
done

echo "ITN helper written to $OUTPUT_BINARY"
echo "ITN libraries written to $LIB_OUTPUT_DIR"
