# Hotkey Mic Race Resolution

**Date:** 2025-09-25  
**Agent:** Codex (GPT-5)  
**Status:** ✅ Completed  

## User Intention
The user wanted the push-to-talk hotkey to start recording instantly while ensuring the microphone shuts off the moment the gesture ends, eliminating both the previous startup delay and a regression where short presses left the mic recording indefinitely.

## What We Accomplished
- ✅ **Restored instant mic activation** - Reworked gesture handling to pre-run permission gates without blocking `start()` so audio capture spins up immediately on Option press.
- ✅ **Closed runaway recording race** - Added capture-session bookkeeping and deferred stop scheduling so short holds and canceled gestures automatically stop once `start()` resolves.
- ✅ **Stabilized transcription init** - Hardened `useTranscription.start()` with stream guards to avoid crashes when the stream is released mid-gesture.

## Technical Implementation
Introduced tokenized capture sessions that track in-flight `start()` calls, queueing `cancel`/`stop` actions if the gesture ends before the mic flips to `recording`. A recorder-state effect now recognizes queued post-start actions, ensuring they fire once `start()` completes. Permission checks run in parallel via cached promises while UI updates immediately. In `useTranscription`, missing stream protection prevents `createMediaStreamSource` from throwing when the gesture aborts before the stream is ready.

**Files Modified:**
- `src/components/App.tsx` - Added capture session tracking, deferred stop scheduling, and gesture handler updates to remove mic delay without sacrificing guardrails.
- `src/hooks/useTranscription.ts` - Added stream presence check before constructing the audio graph to avoid null dereferences during rapid gesture cancellations.

## Bugs & Issues Encountered
1. **Mic kept recording after short press** – Key-up canceled UI but `start()` resolved later, leaving transcription running.  
   - **Fix:** Track active capture tokens, queue cancel actions, and execute them once the start promise resolves.
2. **Runtime crash: `clearActiveCapture` before initialization** – Moved the recorder-state effect below helper definitions to preserve initialization order.  
   - **Fix:** Reordered hooks so dependencies are defined before use.  
3. **`createMediaStreamSource` null error** – Stream torn down before graph creation on fast cancels.  
   - **Fix:** Added null guard in `useTranscription` to bail out cleanly and reset state.

## Key Learnings
- **Deferred async starts need post-actions** – When UI gestures cancel before async work finishes, queuing follow-up actions is safer than calling APIs immediately.
- **Hook initialization order matters** – Effects referencing memoized helpers must appear after those helpers to avoid temporal dead zone errors.
- **AudioContext setup is fragile during rapid cancels** – Always verify the stream is still present before creating nodes.

## Architecture Decisions
- **Tokenized capture sessions** – Chosen to correlate gesture lifecycles with transcription starts, enabling deterministic clean-up without restructuring the hook API.
- **Deferred cancel scheduling** – Preferred over synchronous `cancel()` calls, preventing redundant stream teardown while preserving gesture semantics.

## Ready for Next Session
- ✅ **Gesture engine stable** – Current push-to-talk and double-tap flows behave correctly across quick and long presses.
- 🔧 **Latency metrics** – Could add instrumentation to measure gesture-to-first-frame timing for future regressions.

## Context for Future
This session stabilizes the new hotkey orchestration: the mic responds immediately yet shuts off reliably, providing a robust base for future gesture features or audio prewarm work.
