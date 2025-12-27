# User-Specific Metrics & Analytics

**Last Updated:** 2025-12-27
**Status:** ✅ Implemented (Cloudflare Analytics Engine + Structured Console Logs)

## Purpose

This document describes the user-specific metrics collection system for Spoke. The goal is to track **who is using the app and how much**, enabling:

- **Usage analytics:** Understand which users are power users vs casual users
- **Performance monitoring:** Track average latency metrics across all users with ability to filter by user
- **Product insights:** Identify usage patterns, feature adoption, and user retention
- **Individual statistics:** Future capability to show users their own usage stats (total dictation time, word count, etc.)

---

## Architecture Overview

Spoke uses a **dual-layer observability system**:

1. **Cloudflare Analytics Engine** - Aggregated session metrics for long-term trend analysis and dashboards
2. **Structured Console Logs** - Granular event-level debugging with high-cardinality fields

### Why This Dual Approach?

**Analytics Engine** is designed for:
- Quantitative analysis (P95 latency, success rates, usage trends)
- Cost-effective storage of millions of data points
- SQL queries for dashboards and reports
- Zero perceived latency (fire-and-forget writes)

**Console Logs** are designed for:
- Real-time debugging and troubleshooting
- Detailed request-level inspection (via `wrangler tail`)
- High-cardinality filtering (trace_id, user_id, specific error messages)
- Temporary retention (7-30 days typical)

---

## Analytics Engine: Long-Term Metrics

Replaced the previous Supabase-based `dictation_logs` system on 2025-12-11 for extreme performance and cost-efficiency.

### Data Schema: `session.lifecycle`

As of 2025-12-19, all session metrics are consolidated into a **single data point** to reduce write operations (50% reduction) and improve correlation across pipeline stages.

#### Index (Sampling Key)
- `index1`: `user_id` (or 'anonymous')

#### Blobs (Searchable Strings) - 7 total
1. `blob1`: `'session.lifecycle'` (Event Type - constant)
2. `blob2`: `trace_id` (Correlation ID for matching logs)
3. `blob3`: `outcome` (success | error_auth | error_stt | error_llm | error_send | client_disconnect | timeout | crash)
4. `blob4`: `mode` (dictation | edit)
5. `blob5`: `stt_provider` (groq | deepgram | fireworks | simplismart)
6. `blob6`: `llm_provider` (baseten | openai | groq | cerebras | openrouter | simplismart)
7. `blob7`: `error_stage` (auth | ocr | stt | llm | send)

#### Doubles (Numeric Metrics) - 15 of 20 available
1. `double1`: `worker_lifetime_ms` - Full duration from WebSocket accept to close
2. `double2`: `auth_ms` - JWT verification time (indicates cold start if >500ms)
3. `double3`: `ocr_ms` - Screenshot OCR processing time (context-aware transcription)
4. `double4`: `first_frame_latency_ms` - Auth + TLS + first audio frame upload
5. `double5`: `audio_streaming_ms` - Total time user was speaking
6. `double6`: `assemble_ms` - Audio concatenation/WAV wrapping time
7. `double7`: `stt_ms` - STT API total duration
8. `double8`: `router_overhead_ms` - Time between STT completion and LLM start (smart routing decision time)
9. `double9`: `llm_ms` - LLM API total duration (0 if bypassed)
10. `double10`: `total_processing_ms` - `stt_ms + llm_ms`
11. `double11`: `overhead_ms` - Worker internal overhead (everything else)
12. `double12`: `audio_frames` - Number of 100ms audio frames sent
13. `double13`: `audio_bytes_kb` - Total audio payload size
14. `double14`: `seq_gaps` - Number of dropped/missing frames detected
15. `double15`: `cold_start` - 1 if JWT verification >500ms, 0 otherwise (indicates JWKS fetch)

### SQL Query Examples

Query in **Cloudflare Dashboard → Workers & Pages → Analytics Engine → Query Editor**.

#### Top 10 users by total dictation time (last 24h)
```sql
SELECT
  index1 AS user_id,
  SUM(double5) / 1000 AS total_speaking_seconds,
  COUNT(*) AS session_count
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY user_id
ORDER BY total_speaking_seconds DESC
LIMIT 10;
```

#### P95 Latency by STT Provider (last 7 days)
```sql
SELECT
  blob5 AS stt_provider,
  QUANTILE(double7, 0.95) AS p95_stt_ms,
  COUNT(*) AS count
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY stt_provider;
```

#### Success Rate by Mode
```sql
SELECT
  blob4 AS mode,
  COUNTIF(blob3 = 'success') / COUNT(*) * 100 AS success_rate_pct,
  COUNT(*) AS total_sessions
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY mode;
```

#### Error Rate by Stage (last 24h)
```sql
SELECT
  blob7 AS error_stage,
  COUNT(*) AS error_count,
  AVG(double1) AS avg_worker_lifetime_ms
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 LIKE 'error_%'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY error_stage
ORDER BY error_count DESC;
```

#### Cold Start Rate (JWKS cache effectiveness)
```sql
SELECT
  DATE_TRUNC('hour', timestamp) AS hour,
  COUNTIF(double15 = 1) / COUNT(*) * 100 AS cold_start_rate_pct,
  COUNT(*) AS total_sessions
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY hour
ORDER BY hour DESC;
```

#### Average Latency Breakdown by Provider
```sql
SELECT
  blob5 AS stt_provider,
  blob6 AS llm_provider,
  AVG(double7) AS avg_stt_ms,
  AVG(double9) AS avg_llm_ms,
  AVG(double11) AS avg_overhead_ms,
  COUNT(*) AS session_count
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY stt_provider, llm_provider
HAVING session_count > 10
ORDER BY avg_stt_ms + avg_llm_ms DESC;
```

---

## Console Logs: Real-Time Debugging

As of **2025-12-22**, Spoke follows the **Wide Events** logging pattern (inspired by [loggingsucks.com](https://loggingsucks.com/)).

### Philosophy

- **ONE wide event per transcription** with full context
- **High cardinality** (trace_id) + **high dimensionality** (30+ fields)
- **Removed 40+ noisy logs** (quota updates, state changes, device enumeration)
- **All debug logs gated** behind `SF_DEVTOOLS=1` flag

### Event Structure

All logs are **structured JSON** with consistent snake_case naming following Cloudflare best practices:

```json
{
  "level": "info",              // info | warn | error | debug
  "message": "Human-readable summary for dashboard",
  "event": "session.complete",  // Event type for filtering
  "trace_id": "...",            // Correlation ID
  "user_id": "...",             // User ID (optional)
  // ... event-specific fields
}
```

### Event Types

#### 1. `session.auth` - JWT Authentication
```json
{
  "level": "info",
  "message": "Auth: JWT verified in 0ms",
  "event": "session.auth",
  "outcome": "success",         // success | quota_exceeded | invalid | timeout | missing_token
  "duration_ms": 0,
  "cold_start": false,          // true if JWKS fetch required (>500ms)
  "trace_id": "...",
  "user_id": "..."
}
```

#### 2. `session.ocr` - OCR Context Extraction
```json
{
  "level": "info",
  "message": "OCR: Extracted 26 words in 716ms",
  "event": "session.ocr",
  "outcome": "success",         // success | error | rejected | skipped | no_api_key
  "duration_ms": 716,
  "word_count": 26,
  "trace_id": "...",
  "error_message": null
}
```

#### 3. `session.audio` - Audio Streaming Complete
```json
{
  "level": "info",
  "message": "Audio: 21 frames, 71.88KB over 1.1s",
  "event": "session.audio",
  "frames": 21,
  "bytes_kb": 71.88,
  "streaming_duration_ms": 1080,
  "seq_gaps": 0,                // Frame drops detected
  "trace_id": "..."
}
```

#### 4. `session.stt` - STT Transcription
```json
{
  "level": "info",
  "message": "STT: simplismart transcribed in 1158ms → 61 chars",
  "event": "session.stt",
  "outcome": "success",         // success | error | timeout
  "provider": "simplismart",
  "model": "whisper-turbo",
  "duration_ms": 1158,
  "ttfb_ms": 1158,              // Time to first byte
  "text_length": 61,
  "trace_id": "...",
  "error_message": null
}
```

#### 5. `session.llm` - LLM Post-Processing
```json
{
  "level": "info",
  "message": "LLM: cerebras processed in 523ms → 65 chars",
  "event": "session.llm",
  "outcome": "success",         // success | error | timeout | skipped
  "provider": "cerebras",
  "model": "llama-3.3-70b",
  "duration_ms": 523,
  "ttfb_ms": 89,
  "router_overhead_ms": 2,      // Smart routing decision time
  "text_length": 65,
  "trace_id": "...",
  "error_message": null
}
```

#### 6. `llm.bypassed` - Smart Routing Bypass (2025-12-25)
```json
{
  "event": "llm.bypassed",
  "reason": "no_triggers_detected",   // no_triggers_detected | router_disabled
  "textLength": 61,
  "traceId": "..."
}
```

**Note:** Smart routing metrics (`llm_tier`, `llm_triggered_rules`, `llm_prompt_tokens`, `llm_bypassed`) are currently **logged to console only**, not tracked in Analytics Engine. Future enhancement planned.

#### 7. `session.complete` - Session Lifecycle Summary
```json
{
  "level": "info",
  "message": "Session: Completed in 7.0s (1158ms STT)",
  "event": "session.complete",
  "outcome": "success",         // success | error_auth | error_stt | error_llm | client_disconnect | timeout | crash
  "mode": "dictation",
  "worker_lifetime_ms": 6980,
  "auth_ms": 0,
  "ocr_ms": 716,
  "first_frame_latency_ms": 4642,
  "audio_streaming_ms": 1080,
  "assemble_ms": 0,
  "stt_ms": 1158,
  "llm_ms": 0,
  "total_processing_ms": 1158,
  "overhead_ms": 5106,
  "trace_id": "...",
  "user_id": "...",
  "stt_provider": "simplismart",
  "llm_provider": null,
  "error_stage": null,
  "error_message": null
}
```

#### 8. `session.error` - Detailed Error Tracking
```json
{
  "level": "error",
  "message": "Error at stt (simplismart): Network timeout",
  "event": "session.error",
  "stage": "stt",               // auth | ocr | stt | llm | send | unknown
  "error_type": "NetworkError",
  "error_message": "Network timeout",
  "provider": "simplismart",
  "trace_id": "..."
}
```

### Provider-Specific Debug Logs

#### Simplismart STT Latency Breakdown (2025-12-27)
```json
{
  "message": "[STT:Simplismart] Latency breakdown:",
  "endpoint": "turbo",          // turbo | standard
  "audio_size_kb": "72.34",
  "base64_size_kb": "96.45",
  "compression_ratio": "75.0%",
  "timings": {
    "base64_encode_ms": 12,     // Client-side encoding overhead
    "total_ms": 1458,           // End-to-end fetch time
    "ttfb_ms": 1402,            // DNS + TCP + TLS + Upload + Server Processing
    "body_read_ms": 56          // Response download + JSON parse
  },
  "server_reported_time_ms": 320,           // Simplismart's internal processing
  "estimated_network_overhead_ms": 1082     // ttfb - server_reported_time (🔥 Key metric for diagnosing latency)
}
```

**Use Case:** Diagnose production vs local dev latency discrepancies. If `estimated_network_overhead_ms` >800ms, indicates worker region far from Simplismart India endpoint.

---

## Client-Side Logging: Wide Events Pattern

As of **2025-12-22**, the client (Electron app) follows the same Wide Events pattern.

### Client Session Log
```javascript
console.log("[Session]", {
  trace_id: "...",
  mode: "dictation",
  outcome: "success",
  timing: {
    pttDownMs: 1234567890,
    wsOpenMs: 1234567900,
    firstFrameOutMs: 1234567950,
    statusRecvMs: 1234570000,
    finalRecvMs: 1234571000,
    pasteDoneMs: 1234571100
  },
  audio: {
    frames: 21,
    bytes: 73500
  },
  server: {
    stt_ms: 1158,
    llm_ms: 0,
    llm_tier: "bypass",             // bypass | default | advanced | edit
    llm_triggered_rules: [],
    llm_prompt_tokens: 0,
    llm_bypassed: true
  },
  result: {
    text: "...",
    wordCount: 12
  }
})
```

**Philosophy:** Client includes smart routing metrics that aren't yet in Analytics Engine, providing complete observability when correlated with worker logs via `trace_id`.

---

## Privacy & Security

1. **No Text Storage**: Actual transcription text is **never** sent to Analytics Engine or logged permanently.
2. **No Recordings**: Audio is ephemeral and never stored on the server.
3. **Encryption**: All data encrypted at rest and in transit within Cloudflare infrastructure.
4. **Service Role**: Data written using internal worker bindings, credentials never exposed to client.
5. **User Control**: Users can disable transcription sharing (`shareTranscriptions: false`) to prevent even temporary server-side text processing for dataset improvements.

---

## Performance Characteristics

### Analytics Engine Writes
- **Latency:** 0ms perceived (fire-and-forget via `c.executionCtx.waitUntil()`)
- **Write Volume:** ~1 data point per session (down from 4-5 events pre-consolidation)
- **Cost:** Designed for millions of events, extremely cost-effective
- **Query Latency:** 100ms-2s depending on time range and aggregation complexity

### Console Logs
- **Retention:** 7-30 days (Cloudflare default)
- **Volume:** ~7-10 structured JSON logs per session (down from 40+ noisy logs)
- **Real-time Access:** `wrangler tail --format pretty` for live debugging
- **Filtering:** Support for grep-style filtering on any JSON field

---

## Migration History

### 2025-12-27: Simplismart Latency Instrumentation
- Added granular timing breakdown for Simplismart STT provider
- Tracks base64 encoding overhead, TTFB, body read, and estimated network overhead
- Enables diagnosis of production vs local dev latency discrepancies (CF Worker region vs India endpoint)

### 2025-12-25: Smart LLM Routing Implementation
- Added trigger detection system (spelling, symbols, casing, quotes, disfluency, lists)
- Implemented 4-tier routing: bypass (0ms LLM), default (500-800ms), advanced (1000-1500ms), edit (1000-1500ms)
- Logs `llm.bypassed` event and routing metadata in console (not Analytics Engine yet)
- Achieved <500ms latency for 90% of dictations via bypass tier

### 2025-12-22: Wide Events Logging Migration
- Client: Removed 40+ noisy console logs, replaced with single `[Session]` wide event per transcription
- Worker: Structured JSON logs with consistent snake_case naming
- All debug logs gated behind `SF_DEVTOOLS=1` flag
- Reference: [loggingsucks.com](https://loggingsucks.com/)

### 2025-12-19: Consolidated Analytics Engine Schema
- Merged 4-5 separate events (auth, OCR, STT, LLM, quota) into single `session.lifecycle` event
- 50% reduction in write operations, improved correlation across pipeline stages
- Added `router_overhead_ms` to track smart routing decision time

### 2025-12-11: Analytics Engine Migration
- Replaced Supabase `dictation_logs` table with Cloudflare Analytics Engine
- Removed Sentry instrumentation (150-200 network calls/request eliminated)
- Achieved 266x performance improvement (400s → 1.5s wall time)

---

## Future Enhancements

1. **Smart Routing Metrics in Analytics Engine**: Add `llm_tier`, `llm_triggered_rules`, `llm_prompt_tokens` to schema (currently console-only)
2. **User-Facing Analytics Dashboard**: Show users their own usage stats (total dictation time, word count, favorite providers)
3. **Real-Time Alerting**: Trigger alerts on error rate spikes, latency regressions, or quota exhaustion
4. **A/B Testing Framework**: Track experiment cohorts and provider performance comparisons
5. **Cost Attribution**: Track per-user API costs for LLM/STT usage

---

## Related Documentation

- `TRANSCRIPTION.md` - Full pipeline architecture and metrics generation
- `DATABASE.md` - User profiles and quota tracking (Supabase)
- `INSTRUMENTATION.md` - Sentry error tracking (deprecated as of 2025-12-11)
- `agent-logs/2025-12-19_1920_analytics-engine-integration.md` - Consolidated lifecycle event implementation
- `agent-logs/2025-12-22_2245_remove-noisy-logging.md` - Wide Events migration
- `agent-logs/2025-12-25_1355_smart-llm-routing.md` - Smart routing metrics
- `agent-logs/2025-12-11_2330_nuke-instrumentation-complete.md` - Sentry removal
