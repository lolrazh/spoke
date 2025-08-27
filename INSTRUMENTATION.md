# Instrumentation & Timelines

This document explains the latency instrumentation added to the Sonic Flow transcription pipeline and how to interpret the unified timeline logs.

## What’s instrumented

- A per-session `traceId` is generated on the client and sent in the WebSocket `start` message. The Worker attaches this `traceId` to logs and returns server timings in the `final` message.
- The client and Worker each collect timing points and derived deltas to help pinpoint bottlenecks.

## Client timings (renderer)

Captured in `src/hooks/useTranscription.ts` and logged when the final result arrives:

- Events: `pttDownMs`, `stopInvokedMs`, `wsOpenMs`, `firstFrameOutMs`, `lastFrameOutMs`, `endSentMs`, `statusRecvMs`, `finalRecvMs`, `pasteStartMs`, `pasteDoneMs`.
- Derived deltas:
  - `wsOpenDeltaMs` = `wsOpenMs - pttDownMs`
  - `pttUpToEndSendMs` = `endSentMs - stopInvokedMs`
  - `endSendToStatusMs` = `statusRecvMs - endSentMs`
  - `statusToFinalRecvMs` = `finalRecvMs - statusRecvMs`
  - `finalToPasteDoneMs` = `pasteDoneMs - finalRecvMs`
  - `totalPttDownToPasteMs` = `pasteDoneMs - pttDownMs` (or `finalRecvMs - pttDownMs` if paste not recorded)

Note: `wsOpenMs` includes DNS/TCP/TLS for the WS handshake (approximate connection setup cost).

## Worker timings (Cloudflare Worker)

Captured in `worker/src/index.ts` and returned in the `final` message under `metrics.worker`:

- Session: `wsAcceptAt`, `startedAt`, `processingStartAt`, `frames`, `bytes`, `seqGaps`.
- Arrival spread: `firstArrivalMs`, `lastArrivalMs`, `firstToLastArrivalMs`.
- Assembly: `assembleMs` for PCM→WAV.
- STT HTTP (provider-agnostic):
  - `startAt`, `headersAt`, `bodyDoneAt`
  - `ttfbMs` = time-to-first-byte (headers) from request start
  - `bodyMs` = headers→body parse duration
  - `totalMs` = end-to-end for the STT HTTP request

Notes:
- Cloudflare Workers do not expose TLS handshake separately from `fetch`; `ttfbMs` therefore bundles DNS/TCP/TLS + provider server processing until headers.
- For compatibility, we also include a legacy `metrics.worker.groq.*` mirror of the same values; the renderer prefers `metrics.worker.stt.*`.

## Unified timeline log

At the end of each session the renderer logs a single structured line:

```
[SF] Transcription timeline { traceId, client: {...}, worker: {...} }
```

Use `traceId` to correlate with Worker logs if needed.

## Where to look

- Client: Browser devtools console (enable `SF_DEVTOOLS=1` to keep extra logs if desired).
- Worker: `wrangler dev` console output or Cloudflare logs; entries include `[WS]` and the `traceId`.

## Next steps and deeper visibility

- If you need timings from the native hotkey -> renderer IPC boundary, add timestamps around the `ptt-down`/`ptt-up` emission in `src/main.ts` and include them in the IPC payload for correlation.
- If you need transport-level breakdown beyond TTFB/body, use external observability (e.g., reverse proxy logs) or provider-side dashboards.
