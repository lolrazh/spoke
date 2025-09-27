# Clipboard Selection Capture

**Date:** 2025-09-25  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
User needed Edit Mode to reliably capture selected text across native apps and virtualized editors (Google Docs, Figma) without polluting the clipboard or inserting stray characters, ensuring the production dictation workflow consistently gathers the selection context before invoking the edit LLM.

## What We Accomplished
- ⚠️ **AX-only probing attempt** - Removed clipboard fallback and tried `AXSelectedText`, `AXSelectedTextRange`, and value slicing with whitespace filters; still failed on canvas editors that hide text ranges, so reverted.
- ✅ **Clipboard snapshot probe** - Implemented Cmd+C simulation identical to our paste helper, polling the pasteboard, trimming whitespace, and restoring the original clipboard so Edit Mode captures selections everywhere without user-visible artefacts.
- ✅ **Protocol + telemetry update** - Propagated `selection.source` (`ax` | `clipboard` | `none`) through main process parsing, renderer payloads, worker metrics, and dataset logging for future diagnostics.

## Technical Implementation
Reused the paste helper’s HID sequence to synthesize Cmd+C, snapshot/restore `NSPasteboard` items to keep user state intact, and added change-count polling to detect fresh copy data within ~180 ms. The helper now reports `selectionSource`, and renderer/worker typings were broadened to include `clipboard`. Documentation was updated to describe the new strategy and its guardrails. Worker tests cover parsing of the extended source enum.

**Files Modified:**
- `native/sonic-helper.c` - Added clipboard snapshot/restore utilities, Cmd+C synthesizer, and clipboard-first selection capture outputting `selectionSource`.
- `src/main.ts` - Parsed helper output for new sources and normalized ranges/flags.
- `src/types/shared.ts` - Extended selection snapshot type with `clipboard` source.
- `src/types/protocol.ts` - Propagated optional `selection.source` field for client payloads.
- `src/hooks/useTranscription.ts` - Forwarded source metadata in start messages.
- `worker/src/types/messages.ts` - Accepted the new source enum in parsed start messages.
- `worker/src/handlers/ws.ts` - Logged selection source in spans and dataset events.
- `worker/src/types/messages.test.ts` - Added coverage for `clipboard` source parsing.
- `docs/TRANSCRIPTION.md` - Documented clipboard-based selection capture and fallback behaviour.

## Bugs & Issues Encountered
1. **AX probing returned whitespace** - Web canvas editors exposed blank strings despite real selections, causing Edit Mode to stay in dictation.
   - **Fix:** Abandoned AX-only approach and reinstated clipboard probe with whitespace trimming.
2. **Stray characters on start** - Removing Cmd+C earlier caused editors to paste odd glyphs when edit mode started.
   - **Fix:** Using the paste helper’s command sequence and clipboard restoration prevented visible insertions.

## Key Learnings
- **Clipboard change counts are reliable** for detecting newly created data after simulated key events, enabling tight polling loops.
- **AX APIs remain inconsistent** across web-based canvases even with range access; clipboard probing is the only universal option today.
- **Restoring full NSPasteboard items** preserves non-text formats, keeping users’ rich clipboard contents intact.

## Architecture Decisions
- **Clipboard-first capture** - Chosen over layered AX fallbacks for deterministic behaviour in Google Docs/Figma while matching our existing paste strategy.
- **Source telemetry** - Keeping `selection.source` in session metadata enables future heuristics (e.g., skipping probes when clipboard fails repeatedly).

## Ready for Next Session
- ✅ **Helper rebuilt in source** - Native code is ready for packaging once the binary is regenerated.
- 🔧 **Binary refresh pending** - Rebuild/sign the helper app so release artifacts pick up the new logic.

## Context for Future
This session aligns Edit Mode’s selection capture with the proven clipboard-based insertion path, ensuring consistent behaviour across native and web editors and providing telemetry for further reliability work or heuristics down the line.
