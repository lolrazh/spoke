# WebSocket Stampede & Production Performance Fix

**Date:** 2025-12-17  
**Agent:** Claude Opus 4.5, Claude Sonnet 4.5  
**Status:** ✅ Completed  

## User Intention
User was experiencing critical production issues: loadShed errors (Cloudflare rejecting requests), worker hangs, 15+ second transcription latency, and only the last few words of dictations being processed. The underlying goal was to identify and fix all root causes of the production instability, which turned out to be a **client-side WebSocket stampede** (3 parallel connections) combined with **JWKS caching bugs** and a **double-tap race condition**.

## What We Accomplished
- ✅ **WebSocket Singleflight Pattern** - Prevents multiple callers from creating parallel WebSocket connections (the "3x loadShed" stampede)
- ✅ **Double-Tap Race Condition Fix** - Added `startingRef` to track in-flight start attempts, preventing recording from starting when user meant to stop
- ✅ **JWKS Edge Cache Bug Fix** - `cache.put()` now awaited (was fire-and-forget, causing cache to never warm if worker terminated early)
- ✅ **JWKS Prefetch on Worker Startup** - Middleware warms cache on first request, eliminating cold start latency for subsequent requests
- ✅ **Removed Redundant Retry Loop** - start() now has single connection attempt instead of 3-retry loop (singleflight + preConnect handles retries properly)
- ✅ **Updated Documentation** - TRANSCRIPTION.md updated with singleflight and starting_state patterns

## Technical Implementation

### Singleflight Pattern
```typescript
// useTranscription.ts - prevents parallel WebSocket stampede
const connectionPromiseRef = useRef<Promise<void> | null>(null);

const ensureStreamingSocket = useCallback(async () => {
  if (connectionPromiseRef.current) {
    return connectionPromiseRef.current; // Return existing promise
  }
  // ... connection logic ...
  connectionPromiseRef.current = connectionPromise.finally(() => {
    connectionPromiseRef.current = null;
  });
  return connectionPromiseRef.current;
});
```

### startingRef State Tracking
```typescript
// Tracks in-flight start attempts
const startingRef = useRef(false);

// In start():
if (startingRef.current) return;
startingRef.current = true;
// ... cleared on success, error, or stop/cancel

// In stop():
if (startingRef.current) {
  startingRef.current = false;
  return; // Cancel the in-flight start
}
```

### JWKS Prefetch
```typescript
// worker/src/index.ts
let jwksPrefetched = false;
app.use('*', async (c, next) => {
  if (!jwksPrefetched && c.env.SUPABASE_URL) {
    jwksPrefetched = true;
    (async () => {
      await getJWKS(c.env.SUPABASE_URL);
    })();
  }
  await next();
});
```

**Files Modified:**
- `src/hooks/useTranscription.ts` - Added connectionPromiseRef, startingRef, removed retry loop
- `src/components/App.tsx` - Fixed double-tap detection to check activeCaptureRef as fallback
- `worker/src/auth/supabaseJwt.ts` - Await cache.put(), export getJWKS
- `worker/src/index.ts` - Added JWKS prefetch middleware
- `docs/TRANSCRIPTION.md` - Added singleflight and starting_state documentation

## Bugs & Issues Encountered

1. **WebSocket Stampede (3x loadShed)**
   - **Symptoms:** Every crash showed 3 identical loadShed logs with same timestamp
   - **Root Cause:** `ensureStreamingSocket()` had no mutex, could be called from 8+ locations simultaneously
   - **Fix:** Singleflight pattern with `connectionPromiseRef`

2. **Double-Tap Race Condition**
   - **Symptoms:** Recording STARTS when user double-taps to STOP during cold start
   - **Root Cause:** `recording` state only set true AFTER auth completes; `stop()` checks `if (!recording) return`
   - **Fix:** Added `startingRef` tracking, stop() cancels in-flight start

3. **JWKS Cache Not Warming**
   - **Symptoms:** Every cold start paid 500ms for JWKS fetch despite caching code
   - **Root Cause:** `cache.put()` not awaited - cancelled when worker terminated due to loadShed
   - **Fix:** Added `await` before `cache.put()`

4. **startingRef Early Return Leaks**
   - **Symptoms:** After quota exceeded or mic permission denied, user couldn't start again
   - **Root Cause:** Early returns in start() didn't clear `startingRef`
   - **Fix:** Added `startingRef.current = false` before all early returns

## Key Learnings

- **Singleflight ≠ Retry Prevention** - Singleflight prevents PARALLEL connections, but 3-retry loop still creates 3 SEQUENTIAL connections. Both needed attention.
- **Fire-and-Forget Cache Writes Are Risky** - In Cloudflare Workers, if worker terminates early, non-awaited promises are cancelled. Cache writes especially need `await`.
- **State Machines Need "In-Flight" States** - Boolean `recording` isn't enough; need to track "starting but not yet recording" separately.
- **Check activeCaptureRef, not just pendingStartTokenRef** - The latter gets cleared early by `handlePermissionOutcome`, but `activeCaptureRef` persists until capture completes.

## Architecture Decisions

- **Single connection attempt in start()** - Retry logic moved to preConnect() which runs on app start/sign-in with `retryWithBackoff()`. User-initiated dictation gets one clean attempt with clear error surfacing.
- **Prefetch vs. Blocking Warm-up** - JWKS prefetch is fire-and-forget to not block first request. Second+ requests benefit from warm cache.

## Ready for Next Session

- ✅ **All Phase 1 & 2 fixes complete** - Ready to deploy and test
- 🔧 **Observability (Phase 3)** - Still needs traceId logging for end-to-end debugging

## Observability TODO

Add structured logging with traceId at key points:
1. **Client connection lifecycle:**
   - `[SF] Connection attempt started { traceId, wsState }`  
   - `[SF] Connection authenticated { traceId, latencyMs }`
   - `[SF] Connection failed { traceId, error, attempt }`
2. **Worker-side correlation:**
   - Already has traceId in most logs
   - Add traceId to loadShed context if possible
3. **Metrics to track:**
   - Connection attempt count per dictation
   - Auth latency percentiles
   - Singleflight hit rate (dedupe count)

## Context for Future
This fix addresses the core production stability issues that emerged after auth implementation on Dec 10th. The combination of singleflight, startingRef tracking, and proper JWKS caching should eliminate the loadShed cascade and double-tap bugs. LoadShed reputation with Cloudflare should recover within ~30 minutes of clean traffic post-deploy. Future work on observability will make debugging easier if new issues arise.
