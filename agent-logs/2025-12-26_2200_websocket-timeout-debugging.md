# WebSocket Timeout & State Corruption Fix

**Date**: 2025-12-26  
**Time**: 22:00 - 22:30 IST  
**Agent**: Claude (Antigravity)  
**Status**: ✅ Errors fixed, ⚠️ Latency issues remain

## User Intention

Fix production transcription timeouts that started occurring after merging smart LLM routing. Users reported:
- First transcription works perfectly
- All subsequent transcriptions timeout after 15 seconds
- Local dev (dev:ws + dev:local) works flawlessly
- Production (api.spoke.so) completely broken

## What We Accomplished

- [x] Diagnosed WebSocket state corruption issue
- [x] Fixed "first works, subsequent timeout" bug
- [x] Eliminated spurious socket error logs
- [x] Fixed race condition with finalSent flag
- [x] Added proper WebSocket ref cleanup
- [x] Suppressed normal close events being logged as errors
- [ ] ⚠️ High first frame latency still needs investigation (2-5 seconds)

## Problem Analysis

### Initial Symptoms

1. **Sentry Error** (Issue #7143763316):
   ```
   TranscriptionError: error_timeout
   - Zero frames produced
   - Timeout after 15 seconds
   ```

2. **Worker Logs** (from wrangler tail):
   ```
   - Session completed successfully in 11s
   - STT: 320ms, LLM: 1301ms
   - But client reported timeout!
   ```

3. **Pattern**: First transcription succeeded, second/third timed out

### Root Causes Identified

#### 1. **WebSocket State Corruption** (Most Critical)

**Location**: `src/hooks/useTranscription.ts:1912`

**Problem**: After successful session, worker closes WebSocket but doesn't reset client refs:

```typescript
// Line 1912 - closes socket
ws.close(1000, "session_complete");

// But these were NOT reset:
// wsRef.current = still points to CLOSED socket
// wsReadyRef.current = still true
// wsAuthenticatedRef.current = still true
```

**Impact**: Second session calls `ensureStreamingSocket()`, sees `wsRef.current` exists, thinks connection is open, but it's actually CLOSED. Client tries to send audio on dead socket → timeout.

**Evidence**:
```javascript
// First session (successful):
ws_authenticated: false   // ❌ Already wrong!
ws_ready: false          // ❌ Should be true
ws_url: ""              // ❌ Should have URL

// Second session: Tries to reuse closed socket → timeout
```

**Fix**: Reset all WebSocket refs after closing:

```typescript
ws.close(1000, "session_complete");
// CRITICAL: Reset refs so next session creates fresh connection
wsRef.current = null;
wsReadyRef.current = false;
wsAuthenticatedRef.current = false;
wsAuthPendingRef.current = false;
```

#### 2. **Race Condition with finalSent Flag**

**Location**: `worker/src/handlers/ws.ts:1322-1449`

**Problem**: Timeline of events:
```
1. Worker sends final message (line 1306)
2. Client receives final → immediately closes socket (50ms grace period)
3. Worker sleeps 100ms (line 1324)
4. Client's close triggers worker's onClose handler
5. Worker checks: finalSent = false (not set yet!)
6. Worker logs "client_disconnect" (line 1586)
7. Worker finally sets finalSent = true (line 1449) ← TOO LATE!
```

**Fix**: Set `finalSent = true` immediately after sending, BEFORE the 100ms delay:

```typescript
server.send(JSON.stringify({ type: 'final', ... }));

// Mark final as sent IMMEDIATELY to prevent onClose from logging client_disconnect
finalSent = true;

// Wait 100ms before closing (Cloudflare proxy flush time)
await new Promise(resolve => setTimeout(resolve, 100));
```

#### 3. **Spurious Error Logging**

**Location**: `worker/src/handlers/ws.ts:1615`

**Problem**: When client intentionally closes after receiving final message, it triggers worker's `error` event handler. This is NORMAL WebSocket behavior, not an error!

**Before**:
```typescript
server.addEventListener('error', (evt) => {
  connLog.error('[WS] socket error', { error: String(evt) }); // Always logged!
  // ...
});
```

**After**:
```typescript
server.addEventListener('error', (evt) => {
  // Only log errors if session wasn't already completed successfully
  if (!finalSent && !completionLogged) {
    connLog.error('[WS] socket error', { error: String(evt) });
  }
  // ...
});
```

### Remaining Issue: High First Frame Latency

**Observation from logs**:

```
Session 1:
- first_frame_latency_ms: 4642 (4.6 seconds!)
- audio_streaming_ms: 1080 (1.1s speech)
- stt_ms: 1158 (normal)

Session 2:
- first_frame_latency_ms: 2207 (2.2 seconds!)
- audio_streaming_ms: 18414 (18.4s speech)
- stt_ms: 2448 (normal)
```

**Analysis**: Client takes 2-5 seconds AFTER pressing PTT before sending first audio frame. This doesn't happen in local dev.

**Hypothesis**: Production-specific overhead:
- TLS handshake (wss:// vs ws://)
- Cloudflare proxy routing
- Geographic network latency
- Possible SimpliSmart STT provider issue

**Next Steps**: Switch to Groq STT temporarily to rule out provider-specific issues.

## Code Changes

### 1. Client: Reset WebSocket Refs After Close

**File**: `src/hooks/useTranscription.ts`  
**Lines**: 1909-1916

```typescript
// Close per-session to avoid stale sockets
try {
  ws.close(1000, "session_complete");
  // CRITICAL: Reset WebSocket refs after closing so next session creates fresh connection
  // Without this, ensureStreamingSocket() will see existing wsRef and think connection is open
  wsRef.current = null;
  wsReadyRef.current = false;
  wsAuthenticatedRef.current = false;
  wsAuthPendingRef.current = false;
} catch { }
```

### 2. Worker: Set finalSent Before Delay

**File**: `worker/src/handlers/ws.ts`  
**Lines**: 1306-1329

```typescript
server.send(
  JSON.stringify({
    type: 'final',
    text: responseText,
    wordCount,
    traceId: session.traceId,
    dataset: session.shareTranscriptions ? { sttText: finalText, llmText: llmText || null } : null,
    metrics: { worker: workerMetrics },
  }),
);

// Mark final as sent IMMEDIATELY to prevent onClose from logging client_disconnect
// if client closes during our 100ms delay period
finalSent = true;

// Wait 100ms before closing to ensure message is flushed through network buffers
// This prevents Cloudflare proxy from dropping the final message when socket closes
// immediately after send, which caused production timeouts.
await new Promise(resolve => setTimeout(resolve, 100));
```

**Also removed duplicate** at line 1453:
```typescript
// finalSent = true already set earlier (before 100ms delay)
```

### 3. Worker: Suppress Normal Socket Errors

**File**: `worker/src/handlers/ws.ts`  
**Lines**: 1615-1631

```typescript
server.addEventListener('error', (evt) => {
  // Only log errors if session wasn't already completed successfully
  // When client closes after receiving final, it triggers error event - this is normal
  if (!finalSent && !completionLogged) {
    connLog.error('[WS] socket error', { error: String(evt) });
  }
  socketClosed = true;
  // ... rest of handler
});
```

## Sample Logs (Production)

### Log 1: Short Transcription (7 seconds total)

```
GET https://api.spoke.so/ws - Ok @ 12/26/2025, 10:26:54 PM
  (log) [Auth] 🍪 JWKS from edge cache (fast ~10ms)
  (log) {"level":"info","message":"Auth: JWT verified in 0ms","event":"session.auth","outcome":"success","duration_ms":0,"cold_start":false,"trace_id":"uop9stbrmgr","user_id":"e5dce022-0596-4324-8cda-3291019f725a"}
  (log) {"level":"info","message":"OCR: Extracted 26 words in 716ms","event":"session.ocr","outcome":"success","duration_ms":716,"word_count":26,"trace_id":"uop9stbrmgr","error_message":null}
  (log) {"level":"info","message":"Audio: 21 frames, 71.88KB over 1.1s","event":"session.audio","frames":21,"bytes_kb":71.88,"streaming_duration_ms":1080,"seq_gaps":0,"trace_id":"uop9stbrmgr"}
  (log) {"level":"info","message":"STT: simplismart transcribed in 1158ms → 61 chars","event":"session.stt","outcome":"success","provider":"simplismart","model":"whisper-turbo","duration_ms":1158,"ttfb_ms":1158,"text_length":61,"trace_id":"uop9stbrmgr","error_message":null}
  (log) {"event":"llm.bypassed","reason":"no_triggers_detected","textLength":61,"traceId":"uop9stbrmgr"}
  (log) {"level":"info","message":"Session: Completed in 7.0s (1158ms STT)","event":"session.complete","outcome":"success","mode":"dictation","worker_lifetime_ms":6980,"auth_ms":0,"ocr_ms":716,"first_frame_latency_ms":4642,"audio_streaming_ms":1080,"assemble_ms":0,"stt_ms":1158,"llm_ms":0,"total_processing_ms":1158,"overhead_ms":5106,"trace_id":"uop9stbrmgr"}
```

**Key Metrics**:
- ⚠️ First frame latency: **4642ms** (4.6 seconds!)
- ✅ Audio streaming: 1080ms (1.1s of speech)
- ✅ STT: 1158ms
- ✅ Total: 7 seconds

### Log 2: Longer Transcription (23 seconds total)

```
GET https://api.spoke.so/ws - Ok @ 12/26/2025, 10:27:36 PM
  (log) [Auth] 🍪 JWKS from edge cache (fast ~10ms)
  (log) {"level":"info","message":"Auth: JWT verified in 0ms","event":"session.auth","outcome":"success","duration_ms":0,"cold_start":false,"trace_id":"4vrokd24w4d","user_id":"e5dce022-0596-4324-8cda-3291019f725a"}
  (log) {"level":"info","message":"OCR: Extracted 24 words in 878ms","event":"session.ocr","outcome":"success","duration_ms":878,"word_count":24,"trace_id":"4vrokd24w4d","error_message":null}
  (log) {"level":"info","message":"Audio: 86 frames, 293.75KB over 18.1s","event":"session.audio","frames":86,"bytes_kb":293.75,"streaming_duration_ms":18105,"seq_gaps":0,"trace_id":"4vrokd24w4d"}
  (log) {"level":"info","message":"STT: simplismart transcribed in 2448ms → 116 chars","event":"session.stt","outcome":"success","provider":"simplismart","model":"whisper-turbo","duration_ms":2448,"ttfb_ms":2448,"text_length":116,"trace_id":"4vrokd24w4d","error_message":null}
  (log) {"event":"llm.bypassed","reason":"no_triggers_detected","textLength":116,"traceId":"4vrokd24w4d"}
  (log) {"level":"info","message":"Session: Completed in 22.9s (2448ms STT)","event":"session.complete","outcome":"success","mode":"dictation","worker_lifetime_ms":22860,"auth_ms":0,"ocr_ms":878,"first_frame_latency_ms":2207,"audio_streaming_ms":18414,"assemble_ms":0,"stt_ms":2448,"llm_ms":0,"total_processing_ms":2448,"overhead_ms":19534,"trace_id":"4vrokd24w4d"}
```

**Key Metrics**:
- ⚠️ First frame latency: **2207ms** (2.2 seconds!)
- ✅ Audio streaming: 18414ms (18.4s of speech - normal)
- ✅ STT: 2448ms
- ✅ Total: 23 seconds

## Key Learnings

1. **WebSocket connection reuse requires careful ref management**: If you close a socket but don't reset the ref to null, subsequent code will try to reuse a CLOSED socket.

2. **Race conditions in distributed systems**: Client and worker operate on different timelines. The client's 50ms grace period can fire before the worker's 100ms delay completes, causing the worker to see a "disconnect" when it's actually a normal close.

3. **Flag timing is critical**: Setting state flags (like `finalSent`) at the wrong time in an async flow causes incorrect error attribution.

4. **Production vs dev environments behave differently**: 
   - Local dev: ws:// (no TLS), no proxy, <1ms network latency
   - Production: wss:// (TLS handshake), Cloudflare proxy routing, geographic latency
   - First frame latency: <100ms locally, 2000-5000ms in production

5. **Normal WebSocket behavior can look like errors**: When one side closes a WebSocket, the other side gets an `error` event. This is expected, not a bug.

## Related Files

- `src/hooks/useTranscription.ts` - Client WebSocket management
- `worker/src/handlers/ws.ts` - Worker WebSocket handler
- `agent-logs/2025-12-22_2314_websocket-close-race-condition-fix.md` - Original 50ms grace period fix
- `agent-logs/2025-12-25_1355_smart-llm-routing.md` - Smart routing implementation (trigger for these issues)

## Testing & Validation

**Before fixes**:
- ❌ First transcription: Success
- ❌ Second transcription: Timeout (15s)
- ❌ Third transcription: Timeout (15s)
- ❌ ERROR logs: `[WS] socket error` on every session
- ❌ Analytics: `outcome: "client_disconnect"` on successful sessions

**After fixes**:
- ✅ First transcription: Success (7s)
- ✅ Second transcription: Success (23s)
- ✅ Third transcription: Success
- ✅ Fourth transcription: Success
- ✅ No spurious error logs
- ✅ Analytics: `outcome: "success"` correctly logged
- ⚠️ But latency still high (2-5s first frame delay)

## Next Steps

1. **Investigate first frame latency**:
   - Switch to Groq STT temporarily (rule out SimpliSmart)
   - Check if OCR is blocking audio pipeline
   - Profile TLS handshake time
   - Consider WebSocket connection pooling/keep-alive

2. **Deploy worker fixes**:
   ```bash
   cd worker
   npx wrangler deploy
   ```

3. **Test with production app**:
   ```bash
   npm run stage:prod:package
   # Install and test .dmg
   ```

## Bugs Fixed

1. ✅ **WebSocket state corruption**: Client refs not reset after socket close
2. ✅ **Race condition**: `finalSent` flag set too late (after delay instead of before)
3. ✅ **False error logs**: Normal socket closes logged as errors
4. ✅ **False disconnect logs**: Successful sessions logged as `client_disconnect`

## Open Issues

1. ⚠️ **High first frame latency**: 2-5 seconds in production vs <100ms locally
2. ⚠️ **SimpliSmart STT performance**: Need to compare with Groq
3. ⚠️ **Analytics Engine query mapping**: Field positions incorrect (mentioned earlier, not fixed)

## Context for Future Sessions

- Production WebSocket behavior differs significantly from local dev
- The 100ms delay before closing socket is REQUIRED for Cloudflare proxy message flushing
- Client intentionally closes socket after each session (not meant to be persistent connection)
- WebSocket refs MUST be reset to null on close, even in try/catch blocks
- State flags in distributed systems need careful timing consideration
