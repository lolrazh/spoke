# LLM Post-Processing Integration (Groq)

**Date:** 2025-08-27  
**Agent:** OpenAI Coding Assistant  
**Status:** ✅ Completed  

## User Intention
User wanted to augment the transcription pipeline so that, immediately after audio is transcribed, the text is post-processed by an LLM running on the same worker endpoint to minimize latency (co-located, avoiding extra TLS/TCP cost). They preferred streaming tokens to the client for live feedback while preserving their existing one-shot paste architecture. Model choice: Groq’s GPT-OSS-20B with medium reasoning effort.

## What We Accomplished
- ✅ **LLM post-process added in Worker** – After STT finishes, the worker calls Groq Chat Completions to refine the transcript.
- ✅ **Streaming deltas over WS** – Introduced `llm_status` and `llm_delta` messages; UI can progressively display text while final paste still occurs once.
- ✅ **Final output remains one-shot** – Worker’s `final.text` now carries LLM-edited text; renderer pastes only on the final message to keep the stable paste helper flow.
- ✅ **Config flags and sensible defaults** – `ENABLE_LLM` and `LLM_STREAM` default to enabled; model default is `openai/gpt-oss-20b`; `LLM_REASONING=medium`.
- ✅ **Metrics extended** – Added LLM timings (ttfb, body, total) into `metrics.worker.llm` alongside existing STT metrics.
- ✅ **Bug fix: reasoning field** – Corrected Groq API parameter from `reasoning` to `reasoning_effort` and normalized env value case.
- ⚠️ **Tests pending** – Planned unit tests for LLM client (stream/non-stream) and WS message parsing not added yet.

## Technical Implementation
- Worker continues to buffer PCM16 frames; on `end`, assembles WAV and runs Whisper STT via Groq as before.
- If enabled, immediately runs Groq Chat Completions on the STT text.
  - If streaming is on, parse SSE and forward `llm_delta` chunks to the client; accumulate on the server to produce a definitive `final.text`.
  - If streaming is off, wait for full completion and send only `final`.
- Renderer hook updates on-screen text on `llm_delta` but triggers paste only upon `final`.

**Files Modified:**
- `worker/src/services/llm/groq.ts` – New: Groq chat client with streaming SSE parsing, timing capture, `reasoning_effort` support.
- `worker/src/handlers/ws.ts` – Wire LLM after STT, emit `llm_status`/`llm_delta`, include LLM metrics, and finalize with LLM output.
- `worker/src/types/messages.ts` – Added `ServerLlmStatusMessage` and `ServerLlmDeltaMessage`; extended `ServerMessage` union.
- `worker/src/index.ts` – Extended runtime `Bindings` for `ENABLE_LLM`, `LLM_STREAM`, `LLM_MODEL`, `LLM_REASONING`.
- `src/hooks/useTranscription.ts` – Handle `llm_status`/`llm_delta` for progressive UI while keeping one-shot paste on `final`.

## Bugs & Issues Encountered
1. **Groq API error: unsupported `reasoning` property** – 400 error with message `property 'reasoning' is unsupported`.
   - **Fix:** Use top-level `reasoning_effort` per Groq docs. Also default model to `openai/gpt-oss-20b` and normalize env-provided reasoning value to lowercase.
2. **Streaming paste feasibility** – Existing native paste helper is designed for a single operation; repeated clipboard swaps and paste triggers would be brittle.
   - **Workaround:** Keep progressive UI updates via WS deltas, but perform one final paste only. This preserves robustness and user’s paste architecture.

## Key Learnings
- **Groq streaming uses SSE lines (`data:`)** – Need to parse line-by-line; `[DONE]` marks completion. Some keep-alive lines aren’t JSON.
- **Reasoning parameter naming matters** – Groq expects `reasoning_effort` at top level; not nested.
- **Paste helpers favor one-shot semantics** – Continuous token-level pasting conflicts with clipboard management and target app state.

## Architecture Decisions
- **Progressive display, single paste** – Provide live feedback without destabilizing input focus/clipboard; lowers risk and complexity.
- **Backward-compatible WS protocol** – New `llm_*` messages are optional; legacy clients still function using `final` only.
- **Config-driven LLM step** – Feature flags allow quick disable or tuning (`ENABLE_LLM`, `LLM_STREAM`, `LLM_MODEL`, `LLM_REASONING`).

## Ready for Next Session
- ✅ **Flags and defaults in place** – Works out of the box with `GROQ_API_KEY` configured.
- 🔧 **Add unit tests** – Cover `chatComplete` (stream and non-stream), and message handling in the worker.
- 🔧 **Optional UI toggle** – Expose an app setting to enable/disable LLM streaming without redeploy.
- 🔧 **Tuning parameters** – Consider `max_completion_tokens`, `temperature`, and guardrails/system prompt adjustments.

## Context for Future
This integration keeps latency tight by co-locating both STT and LLM on the worker, while maintaining the reliable one-shot paste flow. Future sessions can iterate on quality prompts, add tests, and expose settings without changing the transport or paste architecture.

