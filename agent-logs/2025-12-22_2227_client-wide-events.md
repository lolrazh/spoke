# Client-Side Wide Event Logging Implementation

**Date:** 2025-12-22  
**Philosophy:** https://loggingsucks.com/  
**Status:** 🚧 Partially implemented - needs integration in useTranscription.ts

---

## What We Just Fixed

### Before (The Problem)
- ❌ Errors silently swallowed in `catch` blocks
- ❌ No Sentry capture for timeout/WebSocket failures  
- ❌ Scattered `console.log()` statements everywhere
- ❌ No correlation between client and server logs
- ❌ When something fails, you have ZERO visibility

### After (Wide Events)
- ✅ **ONE canonical log line** per transcription session
- ✅ **High cardinality**: `trace_id` correlates with server `session.lifecycle`
- ✅ **High dimensionality**: 30+ fields capture full session context
- ✅ **Automatic Sentry capture** on failures with full context
- ✅ **Queryable**: No more grep-ing, you can actually analyze failures

---

## Created Files

### `src/utils/clientSessionLogger.ts`
Client-side equivalent of the server's `session.lifecycle` event.

**Key exports:**
- `ClientSessionEvent` - The wide event schema
- `ClientSessionEventBuilder` - Helper to build event throughout session
- `logClientSession()` - Emits the canonical log line (console + Sentry)

**Example canonical log:**
```json
{
  "timestamp": "2025-12-22T16:18:26.000Z",
  "trace_id": "lhqnveapy6p",
  "session_id": "client_abc123",
  "outcome": "error_timeout",
  "error_message": "Timed out waiting for transcription result",
  "error_type": "TimeoutError",
  "mode": "dictation",
  "vad_enabled": false,
  "ws_ready": true,
  "ws_authenticated": true,
  "ws_final_state": 3,
  "ptt_down_ms": 0,
  "stop_invoked_ms": 49132,
  "end_sent_ms": 49385,
  "dictation_duration_ms": 49132,
  "e2e_latency_ms": null,
  "frames_produced": 155,
  "bytes_produced": 540805,
  "text_length": null,
  "server": {
    "worker_lifetime_ms": 52268,
    "stt_ms": 1055,
    "llm_ms": 934
  }
}
```

---

## Modified Files

### `src/hooks/useTranscription.ts`
**Line 2098-2139:** Added Sentry capture to the `stop()` error handler.

**What it does:**
- Catches timeout/WebSocket errors
- Sends to Sentry with full context (trace_id, timing, WebSocket state)
- Always logs to console (not gated by `devConsoleLogs`)

**⚠️ Still TODO:** Integrate `ClientSessionEventBuilder` throughout the hook lifecycle.

---

## Next Step: Full Integration

You need to replace all the scattered logging in `useTranscription.ts` with the event builder pattern.

### Pattern:

1. **Initialize builder on session start:**
```typescript
const sessionEventRef = useRef<ClientSessionEventBuilder | null>(null);

// In start():
sessionEventRef.current = new ClientSessionEventBuilder(
  metricsRef.current.sessionId,
  sessionModeRef.current
);
sessionEventRef.current
  .setWsUrl(getTranscribeWsUrl())
  .setVadEnabled(VAD_ENABLED);
```

2. **Update builder throughout session:**
```typescript
// When WebSocket opens:
sessionEventRef.current?.setWsState(true, wsAuthenticatedRef.current);

// When audio is produced:
sessionEventRef.current?.setAudioMetrics(
  metricsRef.current.framesProduced,
  metricsRef.current.bytesProduced,
  metricsRef.current.framesForwarded
);

// When timing events happen:
sessionEventRef.current?.setTiming({
  pttDownMs: metricsRef.current.pttDownMs,
  wsOpenMs: metricsRef.current.wsOpenMs,
  stopInvokedMs: metricsRef.current.stopInvokedMs,
  endSentMs: metricsRef.current.endSentMs,
  finalRecvMs: metricsRef.current.sttEndMs,
  pasteDoneMs: metricsRef.current.pasteDoneMs,
});
```

3. **Emit on success:**
```typescript
// When final message received:
sessionEventRef.current
  ?.setServerMetrics({
    workerLifetimeMs: msg.metrics?.worker?.workerLifetimeMs,
    sttMs: msg.metrics?.worker?.stt?.totalMs,
    llmMs: msg.metrics?.worker?.llm?.totalMs,
  })
  .setOutcome('success', { text: msg.text, wordCount: msg.wordCount })
  .emit();
```

4. **Emit on failure:**
```typescript
// In catch block:
sessionEventRef.current
  ?.setWsState(wsReadyRef.current, wsAuthenticatedRef.current, wsRef.current?.readyState)
  .setOutcome(
    err.name === 'AbortError' ? 'cancelled' : 'error_timeout',
    undefined,
    { message: err.message, type: err.name }
  )
  .emit();
```

---

## Benefits

### Correlation with Server Logs
You can now trace a session from client → server:

**Client:**
```
trace_id: "lhqnveapy6p"
outcome: "error_timeout"
e2e_latency_ms: null (never received final)
```

**Server (Analytics Engine):**
```sql
SELECT * FROM dictation_events WHERE blob2 = 'lhqnveapy6p';
-- Shows: outcome = 'success', worker_lifetime_ms = 52268
```

**Insight:** Server succeeded, client timed out → **race condition confirmed**

### Queryable Client-Side Data
Once you pipe client logs to a searchable backend (Cloudwatch, Datadog, etc):

```
// Find all timeout failures in last 24h with their characteristics
SELECT 
  outcome,
  AVG(dictation_duration_ms) as avg_recording_ms,
  AVG(frames_produced) as avg_frames,
  COUNT(*) as count
FROM client_sessions
WHERE outcome LIKE 'error_%'
  AND timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY outcome;
```

### Automatic Sentry Capture
Every failure now goes to Sentry with:
- Full timing breakdown (exactly when things went wrong)
- WebSocket state (was it connected? authenticated?)
- Correlation ID (`trace_id`) to find server logs
- Complete session context (mode, VAD settings, audio stats)

---

## Testing

1. **Trigger a timeout:** Disconnect network mid-transcription
2. **Check console:** Should see `[ClientSession] { outcome: "error_timeout", ... }`
3. **Check Sentry:** Should have a new error with all context
4. **Correlate:** Use `trace_id` to find matching server event in Analytics Engine

---

## Why This Matters

**Before this fix:**
- You: "Something timed out but I have no idea why"
- Reality: Errors swallowed, no logs, no Sentry, no data

**After this fix:**
- Sentry: "TranscriptionError: error_timeout"
- Click error → see full session context
- Copy `trace_id` → query Analytics Engine
- See server completed successfully
- **Diagnosis:** Race condition between server close and client message receive
- **Fix:** Add delay before server close (or client ack mechanism)

---

**Status:** ✅ Foundation complete, 🚧 Full integration needed in `useTranscription.ts`
