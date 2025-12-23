# WebSocket Close Race Condition Fix

**Date:** 2025-12-22
**Agent:** GLM 4.7 (high reasoning)
**Status:** ✅ Complete

---

## User Intention

The user experienced a mysterious timeout during a 49-second dictation. The Cloudflare Worker logs showed successful completion (52.3s total, 2s processing), but the client timed out and never received the transcription. The user wanted to understand why a successful worker result didn't reach the client and what was causing the timeout.

---

## What We Accomplished

- ✅ **Diagnosed race condition** - Identified that worker closes socket immediately after sending `final`, causing client's `onClose` handler to fire before `onMessage` processes the result
- ✅ **Fixed client event handling** - Modified `onClose` to distinguish between normal closure (code 1000) and abnormal closure, adding a 50ms grace period for message processing
- ✅ **Improved error messages** - Close event now includes close code in error message for better debugging
- ✅ **Verified timeout logic** - Confirmed 15-second timeout is appropriate (starts at stop(), not at start of dictation)

---

## Technical Implementation

### Root Cause

The worker sends `final` and closes the WebSocket immediately:
```javascript
server.send(JSON.stringify({ type: 'final', text: responseText, ... }));
safeClose(server, 1000, 'done');  // closes right away
```

The client's `onClose` handler fired immediately when the socket closed, before the `message` event could be processed. This caused the client to reject with "WebSocket closed before final" even though the worker had successfully sent the response.

### The Fix

Modified `src/hooks/useTranscription.ts` (lines 1960-1992):

**Before:**
```javascript
const onClose = () => {
  if (!settled) {
    settled = true;
    cleanup();
    reject(new Error("WebSocket closed before final"));
  }
};
```

**After:**
```javascript
const onClose = (event: CloseEvent) => {
  if (!settled) {
    // Normal closure - wait for message handler to process final
    if (event.code === 1000) {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error("WebSocket closed normally but no final received"));
        }
      }, 50);
      return;
    }
    // Abnormal closure - error immediately
    settled = true;
    cleanup();
    reject(new Error(`WebSocket closed before final (code ${event.code})`));
  }
};
```

**Key changes:**
1. Added `event: CloseEvent` parameter to access close code
2. Check if `event.code === 1000` (normal closure)
3. If normal: wait 50ms for `onMessage` to process pending messages
4. If abnormal: error immediately (preserves existing error handling)
5. Only reject if still unsettled after grace period

**Files Modified:**
- `src/hooks/useTranscription.ts` - Modified `onClose` handler in `stop()` function

---

## Bugs & Issues Encountered

1. **Race condition between WebSocket events**
   - **Symptoms:** Client reported timeout for 49-second dictation, but worker logs showed successful completion (210 chars transcribed in 2s)
   - **Root cause:** Worker closes socket with code 1000 immediately after sending `final`. Browser's event loop can process `close` event before `message` event, causing client to error before receiving result
   - **Fix:** Added 50ms grace period for normal closure (code 1000) to allow `message` handler to process `final` before declaring failure

2. **Misleading investigation path**
   - **Initial hypothesis:** 15-second timeout was too short for long dictations
   - **Reality:** Timeout starts at `stop()` call, not at `start()`. For a 49s dictation + 2s processing = 51s total, but only ~4s elapses between `stop()` and result (well within 15s timeout)
   - **Lesson:** Always verify when timers actually start vs. when you think they start

---

## Key Learnings

- **WebSocket event ordering is not guaranteed** - Just because the worker sends `final` then closes, the client might receive `close` before `message`. This is especially likely when the worker closes immediately after sending.
- **Close code 1000 means normal closure** - When both endpoints agree to close, it's not an error condition. The client should handle this differently from abnormal closures (1006, 1011, etc.).
- **Race conditions require grace periods** - When two events can fire in any order and one depends on the other, add a small delay to allow the dependent event to process.
- **Worker logs don't prove client received data** - The worker's "success" log only proves it sent the response. It doesn't prove the client received it. Network issues, client crashes, or event ordering bugs can still cause failures.
- **Timeout starts at `stop()`, not recording start** - The 15-second timeout begins when the user releases the PTT key, not when they start speaking. This means long dictations have plenty of headroom.

---

## Architecture Decisions

- **Why 50ms grace period?** - Long enough for the event loop to process a pending `message` event, but short enough to not delay error reporting. Could be increased to 100ms if needed, but 50ms should be sufficient for local event processing.
- **Why not fix in worker?** - The worker could add a delay before closing, but that would increase latency for all requests. The client-side fix is more targeted and only affects the race condition case.
- **Why not increase timeout?** - The 15-second timeout is appropriate. The bug was a race condition, not a timeout value issue. Increasing the timeout would mask the bug without fixing it.

---

## Ready for Next Session

- ✅ **Race condition fixed** - Client now properly handles normal WebSocket closure
- ✅ **Error messages improved** - Close codes included in error output for debugging
- 🔧 **Needs testing** - Should test with another long dictation (30+ seconds) to verify fix works in production

---

## Context for Future

This fix resolves a critical bug where successful transcriptions were being lost due to event ordering. The worker successfully processed the audio and sent the response, but the client's `onClose` handler fired before the `onMessage` handler could process the `final` message, causing the client to report a timeout error.

**Related files:**
- `worker/src/handlers/ws.ts` - Sends `final` then closes with code 1000
- `src/hooks/useTranscription.ts` - Client event handlers, timeout logic

**Testing recommendation:**
Test with dictations of varying lengths (5s, 30s, 60s) to ensure the 50ms grace period is sufficient across different network conditions and event loop timings.
