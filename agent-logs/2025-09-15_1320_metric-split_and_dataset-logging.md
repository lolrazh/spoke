# Metric Split (Dictation vs Post‑Dictation E2E) + Dataset Logging

**Date:** 2025-09-15  
**Agent:** OpenAI Codex CLI  
**Status:** ✅ Completed

## User Intention
- Redefine “E2E” to measure post‑dictation latency (hotkey up → paste), and keep dictation length separate. Keep a legacy total for reference.
- Capture dataset entries: the exact ASR text fed to the LLM and the LLM’s final output, with minimal friction to enable/disable.
- Ensure these dataset texts are visible alongside the merged session summary that goes to Sentry.

## What We Accomplished
- ✅ Split metrics and redefined `e2eMs`:
  - `dictationMs`: PTT down → stop
  - `e2eMs`: stop → paste/final (post‑dictation)
  - `totalMs`: PTT down → paste/final (legacy)
- ✅ Client computes and POSTs new fields; Worker includes them in the merged summary (`/metrics/session`).
- ✅ Dataset logging (default ON):
  - Emits `dataset.llm_io` JSON with `sttText` and `llmText` on WS path (tagged with `'session.trace_id'`).
  - Final WS message now carries `dataset` so the client forwards it to `/metrics/session`.
  - Merged `transcription.session_summary` includes `dataset`.
  - Sentry span enriched with `dataset.stt_text`/`dataset.llm_text` and lengths.
- ✅ Docs updated to reflect new metrics, dataset flow, and how to disable.

## Technical Implementation
- Client (`renderer`)
  - `src/hooks/useTranscription.ts`
    - Computes `dictationMs`, `e2eMs` (post‑dictation), `totalMs`.
    - Posts `derived` plus `dataset` (forwarded from server final) to `/metrics/session`.
- Worker (API)
  - `worker/src/handlers/ws.ts`
    - Adds `dataset` to the `final` WS message: `{ sttText, llmText }`.
    - Logs `dataset.llm_io` with `'session.trace_id'` and provider/model.
  - `worker/src/index.ts`
    - `/metrics/session`: attaches full dataset texts and lengths to the Sentry span.
  - `worker/src/utils/summary.ts`
    - `buildSessionSummary` accepts `dataset` and includes it in the merged summary JSON.
- Documentation
  - `docs/INSTRUMENTATION.md` and `docs/TRANSCRIPTION.md` updated with metric split, dataset presence in merged summary, and Sentry span attributes.

## Files Modified
- `sonic-flow-app/src/hooks/useTranscription.ts`
- `sonic-flow-app/worker/src/handlers/ws.ts`
- `sonic-flow-app/worker/src/utils/summary.ts`
- `sonic-flow-app/worker/src/index.ts`
- `sonic-flow-app/docs/INSTRUMENTATION.md`
- `sonic-flow-app/docs/TRANSCRIPTION.md`

## How To Disable Dataset Logging (Simple Toggle)
- Open `worker/src/handlers/ws.ts` and comment out the block labeled:
  - “Dataset logging: ASR→LLM input and LLM output”
- Optional variants:
  - Comment only the `Sentry.logger.info` line to keep the dataset JSON locally in `console` logs, not Sentry.
  - Or switch back to lengths‑only by removing `dataset.*_text` assignment in `worker/src/index.ts`.

## Verification Steps
1. Run the worker and app, perform a dictation.
2. Observe WS logs:
   - `stt.request`, `llm.request`, `dataset.llm_io` (contains texts), followed by server summary.
3. Observe merged summary (from `/metrics/session`):
   - `transcription.session_summary` contains `durations` with `dictationMs`, `e2eMs`, `totalMs`, and `dataset: { sttText, llmText }`.
4. In Sentry, filter by `session.trace_id:<traceId>` and confirm span attributes:
   - `dataset.stt_text`, `dataset.stt_len`, `dataset.llm_text`, `dataset.llm_len`.

## Notes & Follow‑Ups
- Delivery overlaps LLM generation; the new post‑dictation anchor clarifies user‑perceived latency.
- If you want Time‑to‑First‑Visible (first token render) added, we can instrument and include `ttfvMs` next.

