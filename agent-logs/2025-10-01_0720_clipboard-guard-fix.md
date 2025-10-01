# Clipboard Guard Fix for Edit Mode Selection

**Date:** 2025-10-01  
**Agent:** Droid (Claude 4.5 Sonnet)
**Status:** ✅ Completed  

## User Intention
User discovered a critical bug where the edit mode's selection detection was capturing unintended text: Terminal would copy "Last Login..." prompt text, and Notion would copy entire paragraph blocks even when nothing was selected. The underlying goal was to make selection detection intelligent by only triggering Cmd+C when there's actually a selection, while maintaining fallback compatibility for web apps (Google Docs, Figma) where the AX API can't detect selections.

## What We Accomplished
- ✅ **Identified root cause** - `inspect_text_core()` in the native helper unconditionally triggered Cmd+C for all dictation starts, regardless of whether AX detected a selection.
- ✅ **Implemented Option B guard logic** - Added three-tier conditional that uses AX as a gatekeeper: only trigger Cmd+C when selection exists or when AX state is indeterminate (web apps).
- ✅ **Rebuilt and tested native helper** - Compiled changes and validated across Terminal, Notion, and Google Docs.
- ✅ **Verified context field behavior** - Confirmed `context` is captured by helper but never forwarded to worker (dead code reserved for future implementations).

## Technical Implementation
Modified `inspect_text_core()` in `native/sonic-helper.c` to gate the `clipboard_copy_selected_text()` call behind AX selection state validation:

**Three-tier logic:**
1. **Definite selection** (`rangeValid = true`) → trigger Cmd+C to capture text
2. **AX indeterminate** (`!haveSel || sel.location < 0`) → trigger Cmd+C as fallback for web apps
3. **Explicit no-selection** (`haveSel = true` but `sel.length = 0`) → skip Cmd+C entirely

This prevents unwanted clipboard capture in native apps (Terminal/Notion) while preserving Google Docs compatibility.

**Files Modified:**
- `native/sonic-helper.c` (lines ~524-541) - Added conditional logic to `inspect_text_core()` gating `clipboard_copy_selected_text()` behind AX validation

## Bugs & Issues Encountered
1. **Unwanted clipboard capture on no selection** - Cmd+C simulation was always triggered at dictation start, causing Terminal to copy "Last Login..." text and Notion to copy entire paragraph blocks even when cursor had no selection.
   - **Fix:** Implemented three-tier conditional logic that skips Cmd+C when AX explicitly reports no selection (cursor position with length=0), while maintaining fallback for web apps where AX returns unavailable state.

## Key Learnings
- **AX API reliably detects "no selection" state** - When `haveSel = true` and `sel.length = 0`, the user has cursor focus but nothing selected, which can safely gate clipboard probes.
- **Terminal and Notion expose ambient text via Cmd+C** - When nothing is selected, Cmd+C copies contextual text (last terminal output, current Notion block).
- **Google Docs/web apps have indeterminate AX state** - They return `haveSel = false` or `sel.location < 0` (not "no selection" but "can't read selection"), requiring clipboard fallback.
- **Context field is dead code** - The helper captures `context` (surrounding text) but `buildSelectionPayload()` never forwards it to the worker; only `selectedText` reaches the edit prompt.

## Architecture Decisions
- **Option B over Option A** - Trust AX when it explicitly says "no selection", but fallback to Cmd+C when AX state is indeterminate. This provides the tightest guard against false positives while maintaining web app compatibility.
- **Three-tier conditional over simpler two-tier** - Distinguishes between "no selection" (skip Cmd+C) and "can't determine" (try Cmd+C), providing more robust handling across native and web environments.

## Ready for Next Session
- ✅ **Selection detection is now robust** - Works correctly in Terminal, Notion, and Google Docs without false positives.
- ✅ **Context field plumbing exists** - Future work could extend `ClientSelectionPayload` and `prepareEditRequest()` to include surrounding context for tone-matching edits.
- 🔧 **No regression testing yet** - Consider adding unit tests for `inspect_text_core()` logic or integration tests covering selection scenarios.

## Context for Future
This fix completes the edit mode selection detection reliability work started in agent-logs/2025-09-24_1603_selection-inspect-plumbing.md and 2025-09-24_1644_edit-mode-implementation.md. Selection capture now intelligently avoids clipboard probes when unnecessary, eliminating false-positive context injection while maintaining web app fallbacks. Future enhancements could leverage the unused `context` field for richer LLM editing prompts.

## Log References
- `agent-logs/2025-09-24_1603_selection-inspect-plumbing.md` - Initial selection snapshot plumbing
- `agent-logs/2025-09-24_1644_edit-mode-implementation.md` - End-to-end edit mode implementation
- `agent-logs/2025-09-25_0915_clipboard-selection.md` - Clipboard-first capture strategy
