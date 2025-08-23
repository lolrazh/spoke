# LLM Post‑Processing Integration Plan

This document lays out a pragmatic, production‑minded plan to integrate optional LLM post‑processing (Groq) on top of the existing real‑time ASR (Groq Whisper) pipeline. It aims for the fastest viable path first, while structuring code so STT and LLM can be separated later.

## Summary

- Keep the single `/ws` session model for minimal latency and client changes.
- Add an optional LLM step in the Worker after STT completes.
- Drive behavior by flags (per‑session and/or environment) so we can run:
  - ASR only (current behavior)
  - ASR → LLM inline (single final result)
  - Later: ASR → immediate raw, then LLM refined (two‑stage)
- Cleanly split Worker code into small services to allow future separation (STT‑only vs orchestrator Worker).

## Scope

Included:
- Worker orchestration changes to call Groq Chat Completions after STT (optional).
- Message contract additions to signal post‑processing.
- Minimal renderer changes to pass a `postprocess` option in the `start` message (and/or use env defaults).
- Observability (timings, policy used, fallback behavior).

Out of scope (Phase 1):
- Streaming LLM deltas to the client.
- New HTTP endpoints (LLM‑only, batch transcription). These are Phase 2.
- UI changes beyond toggling the feature via env/flag.

## Goals & Principles

- Low‑latency default, high reliability, deterministic output.
- Backward compatible with current clients and protocol.
- Explicit close of websocket connections on all paths.
- Privacy‑aware: keep secrets server‑side; limit logging of content.

## Architecture Overview

High‑level session flow (Phase 1 inline mode):

1) Renderer captures audio, streams PCM16 frames over `/ws`.
2) Worker assembles PCM → WAV and calls Groq STT (Whisper).
3) If post‑processing is enabled, Worker calls Groq Chat Completions with the STT text.
4) Worker sends a single `final` message (either raw STT or refined LLM text) and closes the socket.

Separation of concerns inside Worker:
- `services/stt.ts` — Integration with Groq Whisper (existing logic extracted).
- `services/llm.ts` — Integration with Groq Chat Completions.
- `pipeline/transcribe.ts` — Session orchestration: frames → WAV → STT → optional LLM → responses.
- `utils/wav.ts`, `utils/frames.ts` — WAV wrapping and frame header utilities (extracted from current `index.ts`).

This refactor enables a future split into two deployable Workers (STT‑only and Orchestrator). For now, keep a single Worker for simplicity.

## Protocol Additions (no breaking changes)

Client → Server `start` message (additive):
```json
{
  "type": "start",
  "version": 2,
  "format": "pcm16le",
  "rate": 16000,
  "language": "en",
  "postprocess": {
    "enabled": true,
    "mode": "inline",            // "inline" | "raw_first" (future)
    "style": "clean",              // "clean" | "summary" | "bullet" (extensible)
    "instructions": "optional system/user hints",
    "temperature": 0.1,
    "max_tokens": 512
  }
}
```

Server → Client messages (existing plus additive):
- `{ "type": "status", "state": "processing" }` — STT start (unchanged)
- `{ "type": "status", "state": "postprocessing" }` — LLM start (new, optional)
- `{ "type": "final", "text": "..." }` — Final output (either raw STT or LLM result)
- `{ "type": "error", "body": "..." }` — Error; if LLM fails, we still prefer sending raw STT as `final` then closing.

Notes:
- In Phase 1, we maintain a single `final` to keep the renderer unchanged.
- In a future “raw_first” mode, we can emit `{ type: "raw", text }` followed by `{ type: "final", text }`.

## Worker Changes (Phase 1)

Files and responsibilities (new files are illustrative; names can be adjusted to match style):

- `worker/src/services/stt.ts`
  - `groqTranscribe(wav: Uint8Array, opts): Promise<{ text: string }>`
  - Encapsulate FormData, fetch, timeout, error handling.
  - Model chosen by `GROQ_STT_MODEL` with fallback to current default.

- `worker/src/services/llm.ts`
  - `groqPostprocess(input: string, opts): Promise<string>`
  - OpenAI‑compatible Chat Completions request:
    - Endpoint: `https://api.groq.com/openai/v1/chat/completions`
    - Model: `GROQ_LLM_MODEL` (e.g., gpt‑oss‑120b; confirm exact ID)
    - Messages: system prompt + user = STT text
    - Params: `temperature`, `max_tokens`, `timeout` (e.g., 6–8s)

- `worker/src/utils/wav.ts`
  - Existing `wrapWav` extracted; keep tested logic identical.

- `worker/src/utils/frames.ts`
  - Existing frame header parse/util extracted; keep identical.

- `worker/src/pipeline/transcribe.ts`
  - Orchestrate per‑session state: accumulate frames → WAV → STT → optional LLM.
  - Emit `status: processing`, optional `status: postprocessing`, then `final`.
  - Always close socket explicitly; map failures to close codes (1000/1009/1011).
  - Fallback: if LLM errors/timeouts, send raw STT as `final` and log `pp_error`.

- `worker/src/index.ts`
  - Thin router: websocket upgrade → delegate to pipeline.

Timeouts and guards:
- STT timeout: keep ~25s (existing).
- LLM timeout: 6–8s default; cancel if socket closes.
- Max input length to LLM: cap characters/tokens to avoid lat spikes (configurable).

Env vars (Worker):
- `GROQ_API_KEY` (required)
- `GROQ_STT_MODEL` (optional)
- `GROQ_LLM_MODEL` (optional; default disabled if missing)
- `LLM_TIMEOUT_MS` (optional)
- `PIPELINE_DEFAULT_MODE=asr_only|inline_pp` (optional)
- `PP_DEFAULT_STYLE=clean|summary|bullet` (optional)

Close codes and errors (unchanged patterns):
- 1000 normal, 1009 payload too large, 1011 server error.

Metrics (extend existing logSession):
- `sttMs`, `llmMs`, `ppEnabled`, `ppMode`, `ppStyle`, `rawLen`, `refinedLen`, `ppError?`.

## Renderer Changes (Phase 1)

Minimal path (no visible UI changes):
- Allow a `postprocess` option in the `start` message when establishing the WS session. Default can be driven from `VITE_POSTPROCESS_DEFAULT` and `VITE_POSTPROCESS_MODE`.
- No change to response handling: still wait for a single `final`. If Worker sends `status: postprocessing`, optionally log it in dev console.

Renderer env (optional):
- `VITE_POSTPROCESS_DEFAULT=0|1`
- `VITE_POSTPROCESS_MODE=inline|raw_first` (inline in Phase 1)
- `VITE_POSTPROCESS_STYLE=clean|summary|bullet`

## Prompting Strategy (LLM)

System prompt baseline:
> You are a transcription post‑processor. Correct casing and punctuation, and remove verbal fillers (e.g., “um”, “uh”) and false starts. Do not add, summarize, or change meaning. Retain acronyms, names, and technical terms. Output only the cleaned text.

User prompt: the raw STT transcript.

Parameters:
- `temperature`: 0–0.2 (stability)
- `max_tokens`: 512 (tune per typical length)
- Optional styles (`clean`, `summary`, `bullet`) map to minor prompt variants.

## Performance & Reliability

- Inline mode adds one extra RTT; set LLM timeout tight to bound latency budget.
- If LLM fails, always return raw STT as `final` (do not block insertion).
- Consider skipping LLM for very short transcripts (< N chars) to save cost/latency.
- Keep existing backpressure and explicit `ws.close(...)` discipline.

## Security & Privacy

- Keep `GROQ_API_KEY` only in the Worker.
- Avoid logging full text; log lengths and hashes if needed.
- Allow an env to disable LLM quickly (`PIPELINE_DEFAULT_MODE=asr_only`).

## QA Plan (Manual)

Scenarios:
- ASR‑only: verify `final` equals raw Whisper; latency unchanged.
- Inline PP enabled: verify `status: postprocessing` then single `final` equals LLM output; bounded latency.
- LLM timeout: shorten `LLM_TIMEOUT_MS` → ensure fallback to raw STT with `ppError` metric.
- Empty audio and short utterances: ensure graceful handling.
- Non‑English: ensure prompt doesn’t mangle; consider bypass or language‑aware behavior.

Dev commands (unchanged):
- App: `npm run dev` (and `npm run dev:local` to point to local WS)
- Worker: `npm run dev --prefix worker`

Verification checklist:
- [ ] One `final` only in inline mode
- [ ] Explicit WS close received by client
- [ ] Metrics include `llmMs` when enabled
- [ ] Fallback to raw STT on LLM failure

## Phase 2 (Separation & Options)

Endpoints:
- Keep `/ws` for ASR‑only (unchanged contract).
- Add query/flag `?pp=1` to enable orchestrated flow without client body changes.
- Add `POST /postprocess` for LLM‑only on arbitrary text (useful for re‑processing and unit tests).
- Optionally add `POST /transcribe` for batch WAV → STT with `pp` toggle.

Repo structure after split:
- `worker/src/handlers/ws.ts` — WebSocket entry, delegates to transcribe pipeline.
- `worker/src/handlers/http.ts` — HTTP endpoints: health, postprocess, transcribe.
- `worker/src/pipeline/` — Orchestration modules.
- `worker/src/services/` — STT and LLM clients.
- `worker/src/utils/` — WAV/frames/helpers.

## Implementation Tasks (Checklist)

Worker:
- [ ] Extract `wrapWav` and frame parsing to `utils`.
- [ ] Extract Groq STT call to `services/stt.ts`; preserve timeout and error handling.
- [ ] Implement `services/llm.ts` for Groq Chat Completions with timeout and prompt controls.
- [ ] Add `pipeline/transcribe.ts` to orchestrate STT → optional LLM, with metrics.
- [ ] Update `index.ts` to delegate to pipeline; keep explicit close codes.
- [ ] Add env parsing and defaults (inline PP off by default, or configurable).

Renderer:
- [ ] Add `postprocess` payload in `start` message when enabled via env/setting.
- [ ] Optionally log `status: postprocessing` in dev mode; no other behavior changes.

Docs & Config:
- [ ] Update `TRANSCRIPTION.md` with post‑processing phase and message contract.
- [ ] Add `.env` and Worker secrets docs for `GROQ_LLM_MODEL` and timeouts.

QA:
- [ ] Validate latency budget with and without PP.
- [ ] Validate fallback on LLM error/timeout.
- [ ] Validate that old clients (no `postprocess`) keep working.

## Acceptance Criteria

- When `postprocess.enabled=false` or disabled by env: identical behavior to current app.
- When `postprocess.enabled=true` (inline): one `final` representing LLM‑refined text; socket closes normally; metrics record STT and LLM timings.
- On LLM error/timeout: client still receives raw STT as `final` and the session closes; error recorded in metrics.

## Future Enhancements

- “Raw‑first” mode: emit `{ type: "raw" }` immediately, then `{ type: "final" }` with LLM output; adjust renderer to preview vs insert.
- Streaming LLM (`pp_delta`, `pp_final`) for a typing effect.
- Language detection to adapt prompts or to bypass PP when inappropriate.
- Domain‑specific prompting profiles (e.g., code dictation mode).

