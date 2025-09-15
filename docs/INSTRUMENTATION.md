**Sentry Instrumentation**

This document describes the complete Sentry setup for Sonic Flow across both projects:

- sonic-flow-app (Electron app: main + renderer)
- sonic-flow-api (Cloudflare Worker: WebSocket ingest + HTTP endpoints)

It covers environments, what we capture, how logs and traces correlate per dictation, and how to verify/troubleshoot.

**Projects & SDKs**
- **Electron App**: `@sentry/electron` configured in both processes.
  - Renderer init: `src/renderer.tsx:1`
  - Main init: `src/main.ts:1`
- **Cloudflare Worker**: `@sentry/cloudflare` with tracing + Logs.
  - App wrapper + options: `worker/src/index.ts:1`

**Environments & DSNs**
- App (Vite-injected):
  - `VITE_SENTRY_DSN`: DSN for sonic-flow-app
  - `VITE_SENTRY_ENVIRONMENT`: `dev` | `staging` | `prod`
  - Set for packaged builds via npm scripts or `.env` before build.
- Worker (Wrangler/CF env):
  - `SENTRY_DSN`: DSN for sonic-flow-api
  - `SENTRY_ENVIRONMENT`: environment name

**What We Capture (App)**
- **Errors + breadcrumbs** with PII filtering:
  - URL query stripped and auth-like headers filtered in `beforeSend`.
  - Renderer: `src/renderer.tsx:1`  Main: `src/main.ts:1`
- **Performance (optional)**: `tracesSampleRate` enabled (1.0 in dev, 0.1 in prod). No custom transactions yet; add if needed.

**What We Capture (Worker)**
- **Traces**: A session span per dictation and HTTP client spans for STT/LLM.
  - Session span: `worker/src/handlers/ws.ts:1` (around the transcription flow)
  - STT span: `worker/src/services/stt/groq.ts:1`
  - LLM span: `worker/src/services/llm/groq.ts:1`
- **Logs** (Sentry Logs product):
  - Console logs are forwarded to Sentry via `consoleLoggingIntegration` and `enableLogs: true` (`worker/src/index.ts:1`).
  - Our logger writes level-appropriate console calls: `worker/src/utils/logger.ts:1`.
  - Key log events emitted with a per-dictation tag `'session.trace_id'`:
    - `ws.accepted` when the socket is accepted
    - `session.start` when the client’s `start` is received
    - `session.summary` once per dictation (server summary)
    - `session.ws_close` for abnormal closes

**Per-Dictation Correlation**
- The renderer sends a unique `sessionId` in the `start` message.
- The Worker preserves this as `traceId` and attaches `'session.trace_id'` to all Logs for that dictation.
- Search in Sentry Logs with `session.trace_id:<value>` to see the entire story.

**Unified Session Summary (Logs)**
- The Worker emits a structured JSON line with event `transcription.session_summary` per dictation.
- There are two flavors:
  - Server-only (when no client metrics are posted): includes `durations` (server), `traffic`, `result`, `ws`.
  - Merged (after the client POSTs `/metrics/session`): includes the above plus `durations` merged with client timings, and, when available, `dataset: { sttText, llmText }`.
- Schema (merged):
  - `event`: `"transcription.session_summary"`
  - `id`: traceId
  - `pipeline`: `"stt" | "stt+llm"`
  - `durations`: `e2eMs` (stop→paste), `dictationMs`, `totalMs`, `captureMs`, `deliverMs`, `pasteMs`, `wsAcceptToFinalMs`, `assembleMs`, `sttMs`, `llmMs`, `serverProcessingMs`, `overheadMs`
  - `traffic`: `frames`, `bytesKB`, `seqGaps`, `firstToLastArrivalMs`
  - `result`: `textLen`
  - `dataset?`: `{ sttText, llmText }` (present when the server included dataset on the final message)
  - `ws`: `closeCode`, `closeReason`
- Source files: `worker/src/handlers/ws.ts:1`, `worker/src/utils/logger.ts:1`

**Client E2E Metrics**
- The renderer computes timings and posts them to the API. E2E is now split:
  - `dictationMs`: PTT down → stop (user talk time)
  - `e2eMs`: stop → paste/final (post‑dictation latency)
  - `totalMs`: PTT down → paste/final (legacy total)
  - Metrics URL resolution: `src/config/api.ts:1`
  - Post on final: `src/hooks/useTranscription.ts:1`
- The Worker accepts the payload and logs a merged summary with `containsClientMetrics: true`:
  - Route: `POST /metrics/session` in `worker/src/index.ts:1`
  - CORS enabled for `/metrics/*` in dev.

**Dataset Logging**
- Purpose: capture ASR→LLM input and LLM output for building a private dataset.
- Default: enabled in code. To disable, open `worker/src/handlers/ws.ts` and comment out the block labeled “Dataset logging: ASR→LLM input and LLM output”.
- Behavior:
  - Emits a single JSON log per dictation: `event: "dataset.llm_io"`
  - Fields: `traceId`, `language`, `sttText` (ASR output), `llmText` (LLM output or `null` if LLM disabled), `llm.provider`, `llm.model`, `ts`.
  - Location: emitted after processing in `worker/src/handlers/ws.ts`.
  - Delivery: logged to `console` and forwarded to Sentry Logs via `consoleLoggingIntegration`.
- Privacy: this includes full text. Comment the block out in shared or production environments unless content logging is acceptable.

 - Consolidated summary: the server now includes `dataset` on the final message and the client forwards it to `/metrics/session`. The merged summary JSON will contain:
   - `dataset: { sttText, llmText }`
   - Sentry span adds `dataset.stt_len` and `dataset.llm_len` attributes for quick filters.

**PII & Privacy**
- App filters request URLs and headers in `beforeSend` (Auth tokens/API keys redacted).
- Worker logs only include text length (`textLen`), never the full transcript.

**Operational Queries (Sentry Logs)**
- Show all dictations in env:
  - `event:"transcription.session_summary" environment:<env>`
- Group a single dictation:
  - `session.trace_id:<traceId>`
- Investigate abnormal closes:
  - `session.ws_close level:warning` (or search for `"tag":"ws_close"` in raw JSON)
- Performance outliers (quick scan):
  - `event:"transcription.session_summary" durations.serverProcessingMs:>1500`

**Local Verification**
- Test log endpoint: `GET /logs/test` adds `User triggered test log` to Logs.
  - Route: `worker/src/index.ts:1`
- Dev flow:
  - Worker: `npm run dev:ws` from `worker/` (port 8787)
  - App dev, prod WS: `npm run dev:prod`
  - App dev, local WS: `npm run dev:local`

**Turning Traces On/Off (Worker)**
- If you prefer a logs‑only view in sonic-flow-api, reduce sampling:
  - Set sampling to 0 in the Worker Sentry options and rely on Logs as the source of truth.

**Troubleshooting**
- No Logs appearing:
  - Verify Logs product enabled for sonic-flow-api
  - Check `SENTRY_DSN`/`SENTRY_ENVIRONMENT` in CF env and that `enableLogs: true` is present (`worker/src/index.ts:1`)
  - Ensure logger uses console levels (`worker/src/utils/logger.ts:1`)
- CORS error posting client metrics in dev:
  - `/metrics/*` has permissive CORS (`worker/src/index.ts:1`); confirm worker is running on 8787
- Double traces (GET /ws and POST /metrics/session):
  - Expected, two HTTP requests; use Logs for a single-session view via `session.trace_id`

**File Reference Index**
- `src/renderer.tsx:1` — Renderer Sentry init (filters, tracing)
- `src/main.ts:1` — Main Sentry init (filters, tracing)
- `src/config/api.ts:1` — `getMetricsUrl()` and endpoints
- `src/hooks/useTranscription.ts:1` — Client E2E metrics posting on final
- `worker/src/index.ts:1` — Sentry config (Logs integration), `/ws`, `/metrics/session`, `/logs/test`, CORS
- `worker/src/handlers/ws.ts:1` — WS lifecycle, Sentry spans, session summary, per‑session logs
- `worker/src/utils/logger.ts:1` — Structured logging with proper console levels
- `worker/src/services/stt/groq.ts:1` — STT HTTP span
- `worker/src/services/llm/groq.ts:1` — LLM HTTP span

**Appendix: Example Summaries**
```
{
  "event": "transcription.session_summary",
  "id": "abc123",
  "pipeline": "stt+llm",
  "durations": {
    "wsAcceptToFinalMs": 4250,
    "assembleMs": 2,
    "sttMs": 310,
    "llmMs": 190,
    "serverProcessingMs": 500,
    "overheadMs": 100
  },
  "traffic": {
    "frames": 12,
    "bytesKB": 142.3,
    "seqGaps": 0,
    "firstToLastArrivalMs": 3800
  },
  "result": { "textLen": 72 },
  "ws": { "closeCode": 1000, "closeReason": "done" }
}
```

Merged (with client metrics + dataset):
```
{
  "event": "transcription.session_summary",
  "id": "abc123",
  "pipeline": "stt+llm",
  "durations": {
    "e2eMs": 960,
    "dictationMs": 3156,
    "totalMs": 4116,
    "captureMs": 242,
    "deliverMs": 357,
    "pasteMs": 0,
    "wsAcceptToFinalMs": 4200,
    "assembleMs": 1,
    "sttMs": 357,
    "llmMs": 253,
    "serverProcessingMs": 610,
    "overheadMs": 3
  },
  "traffic": { "frames": 34, "bytesKB": 103.22, "seqGaps": 0, "firstToLastArrivalMs": 3220 },
  "result": { "textLen": 49 },
  "dataset": { "sttText": "...", "llmText": "..." },
  "ws": { "closeCode": 1000, "closeReason": "done" }
}
```

**Sentry Span Enrichment**
- The `/metrics/session` route attaches the following attributes to the span:
  - `dataset.stt_text`, `dataset.stt_len`
  - `dataset.llm_text`, `dataset.llm_len`
- This makes the full texts searchable/correlatable in Sentry (intended for your private dataset).
