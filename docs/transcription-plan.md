# Transcription Pipeline Migration Plan

Track progress for migrating to PCM Int16@16k, GROQ STT, and WebSockets with 100 ms chunks.

- 100 ms @ 16 kHz Int16 mono = 1,600 samples ≈ 3.2 KB

## Absolute First
- [ ] Switch wire format to PCM Int16 mono @ 16,000 Hz
- [ ] Configure GROQ STT model; add `GROQ_API_KEY` to `.env`
- [ ] Establish WebSocket ingest (Hono route) and client connection
- [ ] Send fixed 100 ms audio chunks to worker

## Client Audio
- [ ] Add AudioWorklet to output Int16@16k in `process()`
- [ ] 48k→16k: decimate-by-3 with light FIR
- [ ] 44.1k→16k: fractional resampler (linear/polyphase)
- [ ] Normalize/clamp Float32→Int16 in Worklet
- [ ] Chunker: exact 100 ms frames (seq IDs)
- [ ] Ring buffer (SharedArrayBuffer) with message-passing fallback

## WebSocket Transport
- [ ] Define messages: `start`, `audio`(binary+seq), `end`, `error`
- [ ] Per-frame header: `u32 seq | u32 nbytes | u64 client_ts_ns`
- [ ] Open on PTT start; stream frames; send `end` on release
- [ ] Handle backpressure (pause/resume, buffer limits)

## Worker + GROQ
- [ ] Hono `GET /realtime` WS upgrade; session map per connection
- [ ] Buffer/order incoming frames; guard dup/out-of-order
- [ ] On `end`: concat PCM; call GROQ STT (raw PCM or WAV wrap)
- [ ] Send `final_transcript`; emit `error` on failures
- [ ] Use `GROQ_API_KEY` from env; never expose to renderer

## Renderer UX
- [ ] PTT controls: listening → processing states
- [ ] Final-only transcript rendering; optional clipboard insert
- [ ] Retry flow on WS failure (optional HTTP fallback later)

## Metrics & QA
- [ ] Timestamps: `ptt_down`, `first_frame_out`, `last_frame_out`, `ws_end`, `stt_start`, `stt_end`, `final_render`
- [ ] Track: frame loss %, WS errors, reconnects
- [ ] Manual tests: 44.1k vs 48k, long utterances, noisy env, quick commands

## Cleanup
- [ ] Remove MediaRecorder/Opus from hot path
- [ ] Add constants/types: `src/constants/audio.ts`, `src/types/protocol.ts`
- [ ] Update README/architecture; add protocol doc; `.env.example`
- [ ] Lint/format; ensure Worklet builds with Vite/Electron

## Future-Proofing
- [ ] Server-side VAD to auto-finalize (250–400 ms silence)
- [ ] `snippet` message for XML-wrapped commands
- [ ] GROQ LLM streaming over WS (`llm_delta`) with session memory
- [ ] Route modes: transcribe ⇄ command
- [ ] Try 60 ms frames for lower tail if needed
