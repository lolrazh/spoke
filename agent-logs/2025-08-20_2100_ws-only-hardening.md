# WS-Only Hardening and Cleanup

**Date:** 2025-08-20  
**Agent:** OpenAI Coding Agent (Codex CLI)  
**Status:** ✅ Completed  

## User Intention
The user wanted production-parity real-time transcription over WebSockets only, eliminating any HTTP paths and legacy code. They also aimed to minimize transcription latency by ensuring Groq receives proper WAV input without re-encoding, improve the dev workflow to reliably use a local worker during `npm start`, and clean up the repo for a tighter, more maintainable pipeline ahead of pre-alpha dogfooding.

## What We Accomplished
- ✅ **Updated migration plan doc** – Marked completed items, clarified v1 WS protocol, noted remaining streaming work.
- ✅ **Removed legacy MediaRecorder/Opus** – Purged unused refs in `useTranscription` and marked cleanup done in docs.
- ✅ **Guaranteed WAV to Groq** – Worker now WAV-wraps raw PCM if needed, avoiding Groq-side re-encoding.
- ✅ **WS-only dev/prod parity** – Renderer now reliably uses local WS in dev and prod WS in production; removed HTTP allowances.
- ✅ **Worker WS-only** – Removed HTTP endpoints (`/transcribe`, `/ping`) and OpenAPI scaffolding.
- ✅ **Dependency cleanup** – Removed `chanfana` and `zod` from the worker.
- ✅ **Dev scripts** – Added streamlined dev/staging scripts (staging later removed by user; dev retained).

## Technical Implementation
- Renderer endpoint selection: hardened `getTranscribeWsUrl()` to prefer local WS in dev (`import.meta.env.DEV`, localhost) or via `?localWs=1`/`localStorage.sf.localWs=1`; no HTTP fallback used by the app. Main CSP tightened to WS-only sources in dev/prod.
- Worker WAV wrapping: added `isWav()` and `wavifyPcm16le()`; on `end`, concatenate binary frames and WAV-wrap when needed before Groq POST; maintains v1 behavior and future-proofs for streaming PCM.
- WebSocket protocol (v1): client sends `start` (JSON) → single binary audio payload (WAV) → `end`; server replies `status:processing` then `final` with text/segments or `error`.
- Code cleanup: removed unused MediaRecorder/Opus references; deleted Worker HTTP endpoints and their dependencies.

**Files Modified:**
- `docs/transcription-plan.md` – Progress/status updates; aligned plan with actual v1 behavior.
- `src/hooks/useTranscription.ts` – Removed MediaRecorder/Opus refs; WS-only send flow unchanged.
- `src/config/api.ts` – Robust WS URL resolution for dev/prod; no HTTP usage by app.
- `src/main.ts` – CSP connect-src allows only WS endpoints (local in dev, prod in packaged).
- `worker/src/index.ts` – WAV wrapping; WS `/ws` endpoint only; removed OpenAPI route mounts.
- `worker/src/endpoints/transcribe.ts` – Deleted.
- `worker/src/endpoints/ping.ts` – Deleted.
- `worker/package.json` – Removed `chanfana` and `zod`.
- `package.json` – Added `dev`, `dev:ws`, and `package:staging` (staging script later removed by user; dev retained).

## Bugs & Issues Encountered
1. **Renderer hitting prod WS in dev** – App was connecting to `wss://api.sonicflow.app` during `npm start`.
   - **Fix:** Hardened WS URL resolution to default local in dev and added optional force-local flags; updated CSP to allow only WS endpoints.
2. **Potential Groq re-encode latency** – Raw PCM could trigger Groq re-encoding.
   - **Fix:** Worker now detects/ensures WAV (44-byte RIFF header) before POSTing; zero meaningful tail added.
3. **Legacy MediaRecorder/Opus remnants** – Dead code could confuse future work.
   - **Fix:** Removed references and updated plan docs to reflect completion.

## Key Learnings
- **WAV wrapping at edge is cheap and reliable** – Adding a 44-byte header in the Worker avoids Groq-side re-encoding and keeps tail latency minimal.
- **Dev/prod parity needs explicit controls** – Depending on `import.meta.env.DEV` alone can be brittle; adding locality/override heuristics keeps dev aligned with prod while allowing manual overrides.
- **Keep transport single-path** – Removing HTTP routes entirely reduces configuration drift and testing ambiguity.

## Architecture Decisions
- **WS-only transport** – Chosen to match production behavior and minimize divergent code paths; simplifies CSP and debugging.
- **WAV enforcement in Worker** – Centralized WAV wrapping keeps client simple and ensures consistent STT performance regardless of client format quirks.
- **Remove OpenAPI/HTTP** – Reduced surface area and dependencies in Worker to focus on realtime path.

## Ready for Next Session
- ✅ **Worker/renderer aligned on WS-only** – Stable base for moving to streaming.
- 🔧 **Implement 100 ms streaming** – Add per-frame header (seq/nbytes/ts), backpressure handling, and ordering guards.
- 🔧 **Protocol types** – Add `src/types/protocol.ts` to formalize messages and headers.

## Context for Future
This hardening stabilizes the realtime transcription path with prod parity and minimal latency. With the transport simplified and WAV enforced at the edge, the next step is to ship true streaming (100 ms frames) for lower end-to-end latency and better resilience, then iterate on telemetry and UX polish for broader dogfooding.
