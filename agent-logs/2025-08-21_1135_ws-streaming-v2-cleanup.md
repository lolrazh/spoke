# WebSocket Streaming v2: Client + Worker

**Date:** 2025-08-21  
**Agent:** Codex CLI Agent  
**Status:** ✅ Completed  

## User Intention
Replace the one-shot HTTP/WAV transcription with a WebSocket-only pipeline that streams 100 ms PCM16@16k audio frames to the Cloudflare Worker during dictation, assembles a single WAV on stop, and sends it to Groq. Optimize for minimal tail latency, keep cancel latency low, and make streaming the default path without feature flags.

## What We Accomplished
- ✅ **Streaming-only client** — Removed the legacy single-WAV upload path; stream 100 ms PCM16 frames with a 16-byte header throughout capture.
- ✅ **Backpressure + queueing** — Guard on `ws.bufferedAmount`, queue frames when needed, and flush as the socket drains.
- ✅ **Worklet flush** — Added a `flush` message so the final partial frame is emitted before tear down (reduces tail).
- ✅ **Soft cancel semantics** — `cancel` discards buffered audio for the current session without closing the socket; ready for immediate reuse.
- ✅ **Socket reuse** — Reuse an existing WS connection across sessions; send a fresh `start` per session.
- ✅ **Endpoint visibility** — Added one renderer console log and one main-process terminal log that show the WS endpoint used.
- ✅ **Client metrics logging** — Session timestamps and counters (first/last frame, STT timing, frames/bytes) logged once on `final`.
- ✅ **Server v2 handler** — Implemented Worker `/ws` with control messages (`start`, `end`, `cancel`), per-frame header parsing, PCM accumulation, WAV wrap on end, and Groq STT call.
- ✅ **Server logging + limits** — Logged frames, bytes, seq gaps, arrival window; added a ~20 MB audio cap with an error response.
- ✅ **Docs updated** — Documented the v2 protocol, control messages, header layout, cancel semantics, and metrics in `docs/transcription-plan.md`.

## Technical Implementation
- Frame format: 100 ms, PCM16LE @ 16kHz, mono. Per-frame header (little-endian): `u32 seq | u32 nbytes | u64 client_ts_ns`, followed by `nbytes` of PCM.
- Client streams frames as they are produced by the audio worklet; on stop it flushes the queue, sends `end`, and awaits `final`.
- Cancel discards current session data and sends `cancel` (server drops buffers) but keeps the socket alive to minimize re-connection overhead.
- Worker collects frames in memory, tracks sequencing and timing, and on `end` writes a minimal WAV header before calling Groq STT.
- Added minimal logs for endpoint detection and for per-session client/server metrics to diagnose latency and ordering.

**Files Modified:**
- `src/hooks/useTranscription.ts` — Streaming-only path; WS reuse; soft cancel; queue/flush; metrics; endpoint log; removed WAV upload logic.
- `public/worklets/pcm16-downsampler.worklet.js` — Added `flush` handling to emit final partial frame.
- `src/utils/pcm.ts` — Removed `encodeWavInt16`/`concatInt16`; kept `encodeFrameHeader` for streaming.
- `src/types/protocol.ts` — Protocol message types and frame header constant (v2).
- `src/main.ts` — Terminal log for WS endpoint on startup (for quick visibility).
- `worker/src/index.ts` — New WS route with v2 protocol, PCM buffering, WAV wrap, Groq STT call, logging, and size limits.
- `docs/transcription-plan.md` — Marked v2 streaming complete; added protocol and metrics notes.

## Bugs & Issues Encountered
1. **ReferenceError: `pcmChunksRef` not defined** — Residual cleanup line referenced removed buffer.
   - **Fix:** Deleted the leftover `pcmChunksRef.current = []` in `stop()` finally block.
2. **Tail latency on final frames** — Without a flush, the last partial buffer could be delayed or dropped.
   - **Fix:** Implemented `flush` in the worklet and invoked it before teardown to ensure the last partial frame is sent.
3. **Cancel behavior ambiguity** — Closing the socket on cancel added reconnection overhead and complexity.
   - **Fix:** Switched to soft cancel: server discards in-flight session buffers but socket remains open for the next session.

## Key Learnings
- **WAV headers need total data size** — Stream raw PCM frames and add the WAV header once at the end on the server.
- **Streaming overlaps network with speech** — Moving upload during dictation significantly reduces tail latency after PTT up.
- **Soft cancel improves responsiveness** — Keeping the WS open avoids needless reconnects while still scrapping the canceled session.

## Architecture Decisions
- **WS-only transcription** — Removed HTTP fallback to simplify and optimize latency.
- **Server-side WAV assembly** — Centralizes finalization and avoids client-side buffering and re-encoding costs.
- **Per-frame header with sequencing** — Enables gap detection and future telemetry without complicating payloads.
- **Connection reuse** — Reduces churn and connection setup time; each session sends a fresh `start`.

## Ready for Next Session
- ✅ **Streaming path solid** — Client/worker v2 flow is functional and logged.
- 🔧 **Optional SAB ring buffer** — Consider SharedArrayBuffer for lower overhead frame handoff (worklet→main thread).
- 🔧 **VAD on server** — Add silence-based auto-finalization to remove the dependency on PTT timing.
- 🔧 **Metrics surfacing** — Promote console metrics to a small in-app debug UI or structured telemetry.

## Context for Future
This WS-only v2 pipeline lays the foundation for faster, lower-latency dictation. With streaming stabilized, we can confidently layer features like server-side VAD, command/snippet routing, or LLM streaming without reworking the transport or audio pipeline.

