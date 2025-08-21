# Transcription Pipeline Migration Plan

Track progress for migrating to PCM Int16@16k, GROQ STT, and WebSockets with 100 ms chunks.

- 100 ms @ 16 kHz Int16 mono = 1,600 samples ≈ 3.2 KB

## Absolute First
- [x] Switch wire format to PCM Int16 mono @ 16,000 Hz
- [x] Configure GROQ STT model (worker/.dev.vars; `GROQ_STT_MODEL`, `GROQ_API_KEY`)
- [x] Establish WebSocket ingest (Hono `/ws`) and client connection
- [x] Stream fixed 100 ms audio chunks to worker (v2); assemble WAV server-side on `end`.

## Client Audio
- [x] Add AudioWorklet to output Int16@16k in `process()`
- [x] 48k→16k: decimate-by-3 with light FIR
- [x] 44.1k→16k: fractional resampler (linear)
- [x] Normalize/clamp Float32→Int16 in Worklet
- [x] Chunker: exact 100 ms frames (seq IDs)
- [ ] Ring buffer (SharedArrayBuffer) with message-passing fallback

## WebSocket Transport
- [x] Define messages (v1): client `start` (JSON), binary audio payload(s), `end`; server `status:processing`, `final`, `error`.
- [x] Per-frame header for streaming: `u32 seq | u32 nbytes | u64 client_ts_ns` (little-endian)
- [x] Stream frames during capture; on stop: flush, send `end`, await `final`
- [x] Handle backpressure (client `ws.bufferedAmount` guard + queue)

## Worker + GROQ
- [x] Hono `GET /ws` WS upgrade
- [x] Collect incoming frames; track `seq`/gaps; concat in-memory on `end`
- [x] On `end`: wrap PCM in a minimal WAV header; call GROQ STT
- [x] Send `final` (text, segments when available); emit `error` on failures
- [x] Use `GROQ_API_KEY` from env; never expose to renderer

## Renderer UX
- [x] PTT controls: listening → processing states
- [x] Final-only transcript rendering; clipboard insert to active app
- [ ] Retry flow on WS failure (optional HTTP fallback later)

## Metrics & QA
- [x] Timestamps (client): `ptt_down`, `first_frame_out`, `last_frame_out`, `ws_end`, `stt_start`, `stt_end`, `final_render`
- [x] Track (server): frame count, bytes, seq gaps, arrival window
- [ ] Manual tests: 44.1k vs 48k, long utterances, noisy env, quick commands

## Cleanup
- [x] Remove MediaRecorder/Opus code paths
- [x] Add audio constants in `src/config/audio.ts`
- [x] Add protocol types in `src/types/protocol.ts`
- [x] Update `.env.example` (renderer)
  - `VITE_TRANSCRIBE_WS_URL` required
  - `VITE_SF_DEVTOOLS` optional for logs

---

## Protocol (v2)

- Client control: `start { version: 2, format: "pcm16le", rate: 16000, language? }`, `end`, `cancel`
- Client frames (binary): 16-byte header + PCM payload
  - Header (LE): `u32 seq | u32 nbytes | u64 client_ts_ns`
  - Payload: `nbytes` of PCM16LE (100 ms = 1600 samples = 3200 bytes)
- Server responses: `status { state: "processing" }`, `final { text }`, `error { body }`
- Cancel semantics: server discards buffered audio for the session, keeps WS open

## Notes

- Tail latency minimized by streaming while speaking; final upload at stop is just control + any remaining queued frames.
- WAV built server-side only once full length is known (header contains data size).
- Memory limits applied on server (~20 MB cap) to protect against runaway sessions.
- [x] Lint/format; ensure Worklet builds with Vite/Electron

## Future-Proofing
- [ ] Server-side VAD to auto-finalize (250–400 ms silence)
- [ ] `snippet` message for XML-wrapped commands
- [ ] GROQ LLM streaming over WS (`llm_delta`) with session memory
- [ ] Route modes: transcribe ⇄ command
- [ ] Try 60 ms frames for lower tail if needed
