#!/bin/bash
set -euo pipefail

# Absolute paths
ROOT_DIR="/Users/lolrazh/Documents/Projects/sonic-flow/sonic-flow-app"
HELPER_APP="$ROOT_DIR/native/bin/Sonic Flow Helper.app/Contents/MacOS/Sonic Flow Helper"

if [[ ! -x "$HELPER_APP" ]]; then
  echo "❌ Helper not found or not executable at: $HELPER_APP" >&2
  echo "Run: $ROOT_DIR/native/build-helper.sh" >&2
  exit 1
fi

run_success_test() {
  local payload="$1"
  echo "\n=== Test: TextEdit focused (expect success) ==="
  # Bring up TextEdit with a blank document and focus the text area
  osascript -e 'tell application "TextEdit" to activate' \
            -e 'tell application "TextEdit" to if not (exists document 1) then make new document' \
            -e 'delay 0.5' >/dev/null

  # Set clipboard to match payload (so Cmd-V pastes this exact string)
  printf "%s" "$payload" | pbcopy

  # Invoke helper in paste+verify mode
  set +e
  OUT=$("$HELPER_APP" --paste-and-verify "$payload" 2>&1)
  CODE=$?
  set -e
  echo "$OUT"
  echo "exit:$CODE"

  if echo "$OUT" | grep -q "paste:ok:"; then
    echo "✅ PASS: Paste verified"
  else
    echo "❌ FAIL: Expected success"
    return 1
  fi
}

run_failure_test() {
  local payload="$1"
  echo "\n=== Test: Finder focused (expect failure) ==="
  osascript -e 'tell application "Finder" to activate' -e 'delay 0.5' >/dev/null

  # Clipboard still set, but no focused text field
  printf "%s" "$payload" | pbcopy

  set +e
  OUT=$("$HELPER_APP" --paste-and-verify "$payload" 2>&1)
  CODE=$?
  set -e
  echo "$OUT"
  echo "exit:$CODE"

  if echo "$OUT" | grep -q "paste:ok:"; then
    echo "❌ FAIL: Unexpected success (should fail without focused text field)"
    return 1
  else
    echo "✅ PASS: Failure as expected"
  fi
}

PAYLOAD="hello-from-test harness"

run_success_test "$PAYLOAD"
run_failure_test "$PAYLOAD"

echo "\nAll tests finished."


