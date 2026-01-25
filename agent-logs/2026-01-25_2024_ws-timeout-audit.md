# WS Timeout Audit

**Date:** 2026-01-25  
**Agent:** gpt-5.2-codex-xhigh  
**Status:** 🔄 Ongoing  

## User Intention
User wanted a rigorous audit of production transcription failures that consistently timed out at 15 seconds, with a strong suspicion that Cloudflare Workers/WebSocket reliability was the root cause. They also wanted a reliable way to capture and inspect production logs to pinpoint the true bottleneck and eliminate the unreliable behavior so prod behaves like local.

## What We Accomplished
- ✅ **Identified WS backpressure as the likely bottleneck** - `end` control messages can be delayed behind queued audio frames, causing 15s client timeouts before final results arrive.
- ✅ **Added precise end-to-end timing instrumentation** - Added `end_ack` and `finalSentAt` to trace when the worker receives `end` and when `final` is sent.
- ✅ **Exposed WS-delivery diagnostics in client session logs** - Client logs now include `end_ack_ms`, worker lifetime, worker audio stream duration, and `seq_gaps` for loss detection.
- ✅ **Restored Analytics Engine lifecycle writes** - Reintroduced `trackSessionLifecycle()` so long-term metrics resume after refactor.
- ⚠️ **Local session log persistence reverted** - User reverted disk log persistence and WS state logging changes; currently relying on `[Session]` console logs + wrangler tail.

## Technical Implementation
- Added a new server message `end_ack` (sent immediately on `end` receipt) to detect WS delivery delay vs processing delay.
- Added `finalSentAt` to worker metrics to compute worker lifetime and final send timing on the client.
- Client now logs `end_ack_ms`, `worker_lifetime_ms`, `audio_streaming_ms`, and `seq_gaps` in `[Session]` logs for direct correlation.
- Reintroduced Analytics Engine writes via `trackSessionLifecycle()` to resume long-term telemetry after refactor.
- Verified from sample logs that `seq_gaps = 0` indicates no audio loss in the worker pipeline.

**Files Modified:**
- `worker/src/handlers/ws.ts` - Send `end_ack`, include `finalSentAt`, call `trackSessionLifecycle()`.
- `worker/src/types/messages.ts` - Added `end_ack` message type and `finalSentAt` metric.
- `src/hooks/useTranscription.ts` - Record `end_ack_ms` and server metrics (`worker_lifetime_ms`, `audio_streaming_ms`, `seq_gaps`) in `[Session]` log.
- `src/utils/clientSessionLogger.ts` - Extended timing/schema to include `end_ack_ms` and `seq_gaps`.

## Bugs & Issues Encountered
1. **15s client timeout causes false failures** - Client hard timeout can fire before worker finishes, especially when `end` is delayed by WS backpressure.
   - **Fix:** Identified; optional client timeout fix proposed but not applied (user reverted earlier changes).
2. **Analytics Engine data missing after refactor** - `trackSessionLifecycle()` existed but was never called.
   - **Fix:** Added call in `scheduleBackgroundTasks()` to restore dataset writes.
3. **Local session log persistence declined** - Disk logging was added then reverted per user request.
   - **Workaround:** Use `[Session]` console logs + wrangler tail for prod.

## Key Learnings
- **WS control messages can be delayed by queued audio frames** - `end` can be stuck behind buffered audio, delaying processing start and triggering timeouts.
- **`seq_gaps` is the definitive audio-loss signal** - `0` indicates no dropped frames even when latency is high.
- **Analytics Engine requires explicit writes** - Defining the helper isn’t enough; the call must be wired on success/error paths.
- **AI Gateway auth tokens are static** - Cloudflare AI Gateway doesn’t support ephemeral token vending machine flow.

## Architecture Decisions
- **Add `end_ack` and `finalSentAt`** - Enables precise separation of WS delivery delay vs worker processing delay.
- **Log server-side metrics in `[Session]`** - Correlates client and worker timings without cross-host clock sync.
- **Avoid persistent local log storage** - User preference to keep logging ephemeral and console-based.

## Ready for Next Session
- ✅ **Instrumentation in place** - `end_ack` and worker metrics provide the exact WS delay signal.
- 🔧 **Collect failure samples** - Capture `[Session]` logs when 15s timeouts occur to confirm WS delivery delay.
- 🔧 **Decide mitigation** - Options: prioritize `end` over audio frames, drop queued audio on stop, or relax client timeout.

## Context for Future
The core issue appears to be WS backpressure delaying the `end` control message, not STT/LLM latency. The new `end_ack` and `finalSentAt` instrumentation should make it trivial to prove this in production and guide a targeted fix (control-message prioritization or queue trimming) without guessing.
