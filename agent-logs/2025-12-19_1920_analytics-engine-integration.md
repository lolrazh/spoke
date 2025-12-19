# Analytics Engine Integration for Session Lifecycle

**Date:** 2025-12-19
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Implemented (ready for testing)

## Overview

Integrated Cloudflare Analytics Engine with the new consolidated logging system to enable long-term analysis and dashboards. Created a single `session.lifecycle` event that captures complete session metrics in one data point.

## Changes Made

### 1. New Analytics Schema (`worker/src/utils/analytics.ts`)

**Added:** `SessionLifecycleEvent` type and `trackSessionLifecycle()` function

**Schema Design:**

**Index (1 available):**
- `index1`: user_id (for sampling)

**Blobs (7 available, all used):**
```typescript
blob1: 'session.lifecycle'  // Event type (constant for querying)
blob2: trace_id              // For correlation with console logs
blob3: outcome               // success | error_auth | error_stt | error_llm | client_disconnect | timeout
blob4: mode                  // dictation | edit
blob5: stt_provider          // groq | deepgram | fireworks | simplismart
blob6: llm_provider          // baseten | openai | groq | cerebras | openrouter | null
blob7: error_stage           // auth | ocr | stt | llm | send | null
```

**Doubles (20 available, using 15):**
```typescript
double1:  worker_lifetime_ms      // Full worker duration
double2:  auth_ms                 // JWT verification time
double3:  ocr_ms                  // OCR processing time
double4:  first_frame_latency_ms  // Auth + TLS + first upload
double5:  audio_streaming_ms      // User speaking duration
double6:  assemble_ms             // Audio concatenation time
double7:  stt_ms                  // STT API call time
double8:  router_overhead_ms      // Time between STT → LLM
double9:  llm_ms                  // LLM API call time
double10: total_processing_ms     // stt_ms + llm_ms
double11: overhead_ms             // Everything else
double12: audio_frames            // Frame count
double13: audio_bytes_kb          // Audio size
double14: seq_gaps                // Dropped frames
double15: cold_start              // 0 or 1
```

### 2. Helper Function in ws.ts

**Added:** `trackSessionCompletion()` helper (line 208-258)

This function does both:
1. Logs to console via `logSessionComplete()` (for Workers Logs dashboard)
2. Writes to Analytics Engine via `trackSessionLifecycle()` (for long-term analysis)

**Benefits:**
- Single function call for dual logging
- No duplicate code
- Ensures Analytics Engine always matches console logs

### 3. Replaced All Session Completion Calls

**Changed:** All 9 `logSessionComplete()` calls → `trackSessionCompletion()` calls

**Locations:**
- Auth timeout (line 287)
- Missing token (line 366)
- SUPABASE_URL not configured (line 406)
- JWT invalid (line 469)
- Quota exceeded (line 522)
- Auth required (line 593)
- STT/LLM error (line 1132)
- Success (line 1300)
- Client disconnect (line 1538)

### 4. Deprecated Old Events

**Removed:**
- `auth.jwt_verify` Analytics Engine event (line 450)
- `db.quota_increment` Analytics Engine event (line 1248)

**Reason:** All timing metrics are now captured in the comprehensive `session.lifecycle` event, making separate events redundant.

**Migration Path:** Old events commented out with notes. Can be fully removed once migration is verified in production.

## SQL Query Examples

### Find slow sessions
```sql
SELECT
  blob2 AS trace_id,
  double1 AS worker_lifetime_ms,
  double2 AS auth_ms,
  double7 AS stt_ms,
  double9 AS llm_ms,
  double8 AS router_overhead_ms,
  blob3 AS outcome
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND double1 > 5000  -- Sessions > 5 seconds
  AND timestamp > NOW() - INTERVAL '24' HOUR
ORDER BY double1 DESC
LIMIT 100;
```

### Provider performance comparison
```sql
SELECT
  blob5 AS stt_provider,
  blob6 AS llm_provider,
  AVG(double7) AS avg_stt_ms,
  AVG(double9) AS avg_llm_ms,
  AVG(double8) AS avg_router_overhead_ms,
  COUNT(*) AS sessions
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY stt_provider, llm_provider
ORDER BY avg_stt_ms + avg_llm_ms ASC;
```

### Error breakdown by stage
```sql
SELECT
  blob3 AS outcome,
  blob7 AS error_stage,
  COUNT(*) AS count,
  AVG(double1) AS avg_lifetime_ms
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 != 'success'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY outcome, error_stage
ORDER BY count DESC;
```

### Cold start analysis
```sql
SELECT
  SUM(double15) AS cold_starts,
  COUNT(*) AS total_sessions,
  (SUM(double15) / COUNT(*)) * 100 AS cold_start_percentage,
  AVG(CASE WHEN double15 = 1 THEN double2 ELSE NULL END) AS avg_auth_ms_cold,
  AVG(CASE WHEN double15 = 0 THEN double2 ELSE NULL END) AS avg_auth_ms_warm
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '24' HOUR;
```

### Router overhead distribution
```sql
SELECT
  QUANTILE(double8, 0.50) AS p50_router_overhead_ms,
  QUANTILE(double8, 0.95) AS p95_router_overhead_ms,
  QUANTILE(double8, 0.99) AS p99_router_overhead_ms,
  MAX(double8) AS max_router_overhead_ms,
  AVG(double8) AS avg_router_overhead_ms
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND double9 > 0  -- Only sessions that used LLM
  AND timestamp > NOW() - INTERVAL '7' DAY;
```

### Audio quality metrics
```sql
SELECT
  AVG(double12) AS avg_frames,
  AVG(double13) AS avg_audio_kb,
  AVG(double14) AS avg_seq_gaps,
  AVG(double5) AS avg_speaking_duration_ms,
  COUNT(CASE WHEN double14 > 0 THEN 1 END) AS sessions_with_gaps
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '24' HOUR;
```

### Complete session timing breakdown
```sql
SELECT
  blob2 AS trace_id,
  blob4 AS mode,
  blob3 AS outcome,
  double1 AS total_ms,
  double2 AS auth_ms,
  double3 AS ocr_ms,
  double4 AS first_frame_latency_ms,
  double5 AS speaking_ms,
  double6 AS assemble_ms,
  double7 AS stt_ms,
  double8 AS router_ms,
  double9 AS llm_ms,
  double11 AS overhead_ms,
  -- Calculate percentages
  ROUND((double2 / double1) * 100, 1) AS auth_pct,
  ROUND((double7 / double1) * 100, 1) AS stt_pct,
  ROUND((double9 / double1) * 100, 1) AS llm_pct,
  ROUND((double11 / double1) * 100, 1) AS overhead_pct
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '1' HOUR
ORDER BY timestamp DESC
LIMIT 50;
```

## Grafana Dashboard Panels

### Panel 1: Latency P50/P95/P99
```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '5' MINUTE) as time,
  QUANTILE(double1, 0.50) AS p50_total_ms,
  QUANTILE(double1, 0.95) AS p95_total_ms,
  QUANTILE(double1, 0.99) AS p99_total_ms
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY time
ORDER BY time;
```

### Panel 2: Error Rate by Stage
```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '5' MINUTE) as time,
  blob7 AS stage,
  COUNT(*) AS errors
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 != 'success'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY time, stage
ORDER BY time;
```

### Panel 3: Provider Performance
```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '1' HOUR) as time,
  blob5 AS stt_provider,
  AVG(double7) AS avg_stt_ms,
  QUANTILE(double7, 0.95) AS p95_stt_ms
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND blob3 = 'success'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY time, stt_provider
ORDER BY time;
```

### Panel 4: Cold Start Rate
```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL '15' MINUTE) as time,
  (SUM(double15) / COUNT(*)) * 100 AS cold_start_pct
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY time
ORDER BY time;
```

## Files Modified

**Created:**
- None (all updates to existing files)

**Modified:**
- `worker/src/utils/analytics.ts` (+95 lines)
  - Added `SessionLifecycleEvent` type
  - Added `trackSessionLifecycle()` function
  - Marked `trackEvent()` as deprecated

- `worker/src/handlers/ws.ts` (+68 lines)
  - Added `trackSessionCompletion()` helper function
  - Replaced 9× `logSessionComplete()` with `trackSessionCompletion()`
  - Removed 2× old `trackEvent()` calls (auth.jwt_verify, db.quota_increment)

## Testing Checklist

- [ ] Local dev: Verify Analytics Engine writes don't break worker
- [ ] Test success path: Complete transcription, check both console logs AND Analytics Engine
- [ ] Test error paths: Trigger STT error, verify Analytics Engine captures it
- [ ] Verify trace_id matches between console logs and Analytics Engine
- [ ] Run SQL query to confirm data is being written correctly

## Query Verification Commands

```bash
# After testing locally, check Cloudflare dashboard:
# Go to: Workers & Pages → Analytics Engine → Query Editor

# Test 1: Check if events are being written
SELECT COUNT(*) as total_events
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '1' HOUR;

# Test 2: Verify all fields are populated
SELECT *
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
ORDER BY timestamp DESC
LIMIT 10;

# Test 3: Check for any null values in critical fields
SELECT
  SUM(CASE WHEN double1 IS NULL OR double1 = 0 THEN 1 ELSE 0 END) AS null_lifetime,
  SUM(CASE WHEN double7 IS NULL OR double7 = 0 THEN 1 ELSE 0 END) AS null_stt,
  COUNT(*) AS total
FROM dictation_events
WHERE blob1 = 'session.lifecycle'
  AND timestamp > NOW() - INTERVAL '1' HOUR;
```

## Benefits

**Before (multiple separate events):**
- ❌ 2 separate Analytics Engine events per session (auth.jwt_verify, db.quota_increment)
- ❌ Incomplete picture (missing OCR, router overhead, audio metrics)
- ❌ Hard to correlate across events
- ❌ 2× write operations

**After (single lifecycle event):**
- ✅ 1 comprehensive Analytics Engine event per session
- ✅ Complete timing breakdown (auth, OCR, STT, router, LLM, overhead)
- ✅ Easy correlation (all metrics in one row)
- ✅ 1× write operation (50% cost reduction)
- ✅ Audio quality metrics (frames, gaps, size)
- ✅ Cold start detection

## Next Steps

1. **Test locally:** `npm run dev:ws` → trigger transcription → verify Analytics Engine writes
2. **Deploy to production:** Once tested, deploy with `npm run deploy`
3. **Set up Grafana:** Configure dashboards with the queries above
4. **Monitor for 1 week:** Verify data quality and query performance
5. **Remove legacy events:** Clean up old `auth.jwt_verify` and `db.quota_increment` code

## Backwards Compatibility

**For now:**
- Console logs still generate same `session.auth`, `session.stt`, etc. events
- Old `transcription.session_summary` console log preserved
- Legacy `trackEvent()` function still available (marked deprecated)

**Once verified in production:**
- Can remove old Analytics Engine event code (lines 450, 1248)
- Can optionally remove `transcription.session_summary` if not needed

---

**Status:** Ready for local testing, then production deployment.
