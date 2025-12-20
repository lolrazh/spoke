# User-Specific Metrics & Analytics

**Last Updated:** 2025-12-20
**Status:** ✅ Implemented (Cloudflare Analytics Engine)

## Purpose

This document describes the user-specific metrics collection system for Spoke. The goal is to track **who is using the app and how much**, enabling:

- **Usage analytics:** Understand which users are power users vs casual users
- **Performance monitoring:** Track average latency metrics across all users with ability to filter by user
- **Product insights:** Identify usage patterns, feature adoption, and user retention
- **Individual statistics:** Future capability to show users their own usage stats (total dictation time, word count, etc.)

---

## Architecture: Cloudflare Analytics Engine

Spoke uses **Cloudflare Analytics Engine** for all session telemetry. This replaced the previous Supabase-based `dictation_logs` system on 2025-12-11.

### Why Analytics Engine?

1. **Extreme Performance**: Zero-latency writes via `c.executionCtx.waitUntil()`.
2. **Cost-Effective**: Designed for high-volume event data.
3. **Privacy-Safe**: We only store metadata and timing metrics, never transcription text.
4. **Powerful Querying**: Supports SQL queries directly in the Cloudflare Dashboard.
5. **Consolidated Data**: All metrics for a session are captured in a single `session.lifecycle` event.

---

## Data Schema: `session.lifecycle`

As of 2025-12-19, all session metrics are consolidated into a single data point to reduce write operations and improve correlation.

### Index (Sampling Key)
- `index1`: `user_id` (or 'anonymous')

### Blobs (Searchable Strings)
1. `blob1`: 'session.lifecycle' (Event Type)
2. `blob2`: `trace_id` (Correlation ID)
3. `blob3`: `outcome` (success | error_auth | error_stt | error_llm | client_disconnect | timeout | crash)
4. `blob4`: `mode` (dictation | edit)
5. `blob5`: `stt_provider` (groq | deepgram | fireworks | simplismart)
6. `blob6`: `llm_provider` (baseten | openai | groq | cerebras | openrouter)
7. `blob7`: `error_stage` (auth | ocr | stt | llm | send)

### Doubles (Numeric Metrics)
1. `double1`: `worker_lifetime_ms` - Full duration from connection to close
2. `double2`: `auth_ms` - JWT verification time
3. `double3`: `ocr_ms` - Screenshot OCR processing time
4. `double4`: `first_frame_latency_ms` - Latency to first audio frame
5. `double5`: `audio_streaming_ms` - Total time user was speaking
6. `double6`: `assemble_ms` - Audio concatenation/WAV wrapping time
7. `double7`: `stt_ms` - STT API total duration
8. `double8`: `router_overhead_ms` - Time between STT result and LLM start
9. `double9`: `llm_ms` - LLM API total duration
10. `double10`: `total_processing_ms` - `stt_ms + llm_ms`
11. `double11`: `overhead_ms` - Internal worker overhead
12. `double12`: `audio_frames` - Number of 100ms audio frames sent
13. `double13`: `audio_bytes_kb` - Total audio payload size
14. `double14`: `seq_gaps` - Number of dropped/missing frames detected
15. `double15`: `cold_start` - 1 if JWT verification > 500ms (indicates JWKS fetch)

---

## SQL Query Examples

You can run these queries in the Cloudflare Dashboard under **Workers & Pages → Analytics Engine → Query Editor**.

### Top 10 users by total dictation time (last 24h)
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

### P95 Latency by STT Provider
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

### Error Rate by Stage
```sql
SELECT
  blob7 AS error_stage,
  COUNT(*) AS error_count
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 LIKE 'error_%'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY error_stage
ORDER BY error_count DESC;
```

---

## Privacy & Security

1. **No Text Storage**: Actual transcription text is **never** sent to the Analytics Engine.
2. **No Recordings**: Audio is ephemeral and never stored on the server.
3. **Encryption**: All data is encrypted at rest and in transit within Cloudflare's infrastructure.
4. **Service Role**: Data is written using internal worker bindings, never exposing credentials to the client.

---

## Related Documentation

- `TRANSCRIPTION.md` - Details the pipeline that generates these metrics.
- `DATABASE.md` - Describes user profiles and quota tracking (Supabase).
- `agent-logs/2025-12-19_1920_analytics-engine-integration.md` - Implementation details for the lifecycle event.
