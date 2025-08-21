# Transcription Pipeline Migration Plan

Track progress for migrating to PCM Int16@16k, GROQ STT, and WebSockets with 100 ms chunks.

- 100 ms @ 16 kHz Int16 mono = 1,600 samples ≈ 3.2 KB

## Absolute First
- [x] Switch wire format to PCM Int16 mono @ 16,000 Hz
- [x] Configure GROQ STT model (worker/.dev.vars; `GROQ_STT_MODEL`, `GROQ_API_KEY`)
- [x] Establish WebSocket ingest (Hono `/ws`) and client connection
- [ ] Stream fixed 100 ms audio chunks to worker (v2). Current v1 uploads a single WAV after PTT end.

## Client Audio
- [x] Add AudioWorklet to output Int16@16k in `process()`
- [x] 48k→16k: decimate-by-3 with light FIR
- [x] 44.1k→16k: fractional resampler (linear)
- [x] Normalize/clamp Float32→Int16 in Worklet
- [x] Chunker: exact 100 ms frames (seq IDs)
- [ ] Ring buffer (SharedArrayBuffer) with message-passing fallback

## WebSocket Transport
- [x] Define messages (v1): client `start` (JSON), binary audio payload(s), `end`; server `status:processing`, `final`, `error`.
- [ ] Per-frame header for streaming: `u32 seq | u32 nbytes | u64 client_ts_ns` (not used in v1)
- [x] Open on PTT end; upload single WAV; send `end`; close after `final` (v1 behavior)
- [ ] Handle backpressure (pause/resume, buffer limits)

## Worker + GROQ
- [x] Hono `GET /ws` WS upgrade
- [x] Collect incoming binary fragments; concat in-memory on `end` (no seq mgmt in v1)
- [x] On `end`: concat; wrap as WAV; call GROQ STT (fallback to Workers AI if no key)
- [x] Send `final` (text, segments when available); emit `error` on failures
- [x] Use `GROQ_API_KEY` from env; never expose to renderer

## Renderer UX
- [x] PTT controls: listening → processing states
- [x] Final-only transcript rendering; clipboard insert to active app
- [ ] Retry flow on WS failure (optional HTTP fallback later)

## Metrics & QA
- [ ] Timestamps: `ptt_down`, `first_frame_out`, `last_frame_out`, `ws_end`, `stt_start`, `stt_end`, `final_render`
- [ ] Track: frame loss %, WS errors, reconnects
- [ ] Manual tests: 44.1k vs 48k, long utterances, noisy env, quick commands

## Cleanup
- [x] Remove MediaRecorder/Opus code paths
- [x] Add audio constants in `src/config/audio.ts`
- [ ] Add protocol types in `src/types/protocol.ts` (or similar)
- [ ] Update README/architecture; add protocol doc; `.env.example` (root). Worker has `.dev.vars.example`.
- [x] Lint/format; ensure Worklet builds with Vite/Electron

## Future-Proofing
- [ ] Server-side VAD to auto-finalize (250–400 ms silence)
- [ ] `snippet` message for XML-wrapped commands
- [ ] GROQ LLM streaming over WS (`llm_delta`) with session memory
- [ ] Route modes: transcribe ⇄ command
- [ ] Try 60 ms frames for lower tail if needed
