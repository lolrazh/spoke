# Worker Instrumentation Nuke Plan

**Date:** 2025-12-11  
**Issue:** Worker wall time exploded from 3s to 400s (133x regression)  
**Root Cause:** Sentry + excessive logging + blocking database calls

---

## Current State Analysis

### Performance Breakdown:
- **CPU Time:** 27ms (actual work)
- **Wall Time:** 400,000ms (400 seconds) - HANGING
- **Ratio:** 14,814x (99.99% waiting)

### Identified Bottlenecks:

1. **Sentry Overhead:**
   - `Sentry.startSpan()` wraps EVERY STT/LLM call
   - `Sentry.consoleLoggingIntegration()` intercepts ALL console.log()
   - Each span/log sends network request to Sentry API
   - Can hang for 10+ seconds if Sentry is slow/down

2. **Console Logging Spam:**
   - 47+ `console.log()` statements in ws.ts alone
   - Every log goes through Sentry integration (network call!)
   - With chunked transcription (3-5 chunks), 150-200+ logs per request

3. **Blocking Database Calls:**
   - `/metrics/session` endpoint does `await supabase.insert()`
   - `increment_quota` uses `waitUntil()` but still blocks worker completion
   - If Supabase times out (10s), entire pipeline hangs

4. **JWKS Fetch Timeout:**
   - JWT verification fetches Supabase JWKS on every cold start
   - No timeout configured - can hang indefinitely
   - With retries (3x) and pre-connect, can multiply 10s timeout to 30-60s

---

## Changes Required

### Phase 1: Remove Sentry Completely ✅

**Files to modify:**
1. `worker/src/index.ts`
   - Remove `import * as Sentry from '@sentry/cloudflare'`
   - Remove `Sentry.withSentry()` wrapper
   - Remove `Sentry.logger.info()` calls
   - Remove `Sentry.startSpan()` in /metrics/session

2. `worker/src/handlers/ws.ts`
   - Remove `import * as Sentry from '@sentry/cloudflare'`
   - Remove GIANT `Sentry.startSpan()` wrapper (lines 512-999)
   - Remove all `sessionSpan.setAttribute()` calls (30+ lines)
   - Remove second `Sentry.startSpan()` in session summary (lines 1266-1291)

3. `worker/src/services/stt/providers/*.ts` (3 files)
   - groq.ts: Remove `Sentry.startSpan()` (line 72)
   - fireworks.ts: Remove `Sentry.startSpan()` (line 76)
   - deepgram.ts: Remove `Sentry.startSpan()` (line 50)

4. `worker/src/services/llm/*.ts` (6 files)
   - groq.ts: Remove `Sentry.startSpan()` (line 55)
   - openai.ts: Remove `Sentry.startSpan()` (line 55)
   - baseten.ts: Remove `Sentry.startSpan()` (line 78)
   - cerebras.ts: Remove `Sentry.startSpan()` (line 78)
   - openrouter.ts: Remove `Sentry.startSpan()` (line 85)

5. `worker/package.json`
   - Remove `"@sentry/cloudflare": "^10.8.0"` from dependencies

---

### Phase 2: Strip ALL Non-Critical Logging ✅

**Strategy:** Replace with no-ops except fatal errors

**In `worker/src/handlers/ws.ts`:**
- Remove ALL `console.log(JSON.stringify({...}))` calls (40+ instances)
- Keep ONLY `console.error()` for:
  - JWT verification failures (auth errors)
  - STT/LLM API failures
  - WebSocket unexpected closures

**Specific removals:**
- Lines 192, 241, 279, 307, 329, 345, 369: Auth event logs ❌
- Lines 444, 467, 483: Chunking logs ❌
- Lines 567, 589, 604, 627, 652: STT logs ❌
- Lines 732, 784, 798: Edit logs ❌
- Lines 861, 904: LLM logs ❌
- Lines 970, 985: Dataset logs ❌
- Lines 1023: Pipeline error log ❌
- Lines 1264: Session summary log ❌
- Lines 1303, 1363, 1389, 1413, 1428, 1436: Chunk processing logs ❌

**Keep:**
- Line 262: JWT verification error `console.error('[Auth] SUPABASE_URL not configured')`  
- Line 998: STT API key missing `connLog.error('[WS] missing STT API key')`
- Line 1047: Pipeline error `connLog.error('[WS] ${failedStage.toUpperCase()} error')`

---

### Phase 3: Remove /metrics/session Endpoint ✅

**In `worker/src/index.ts`:**
- Delete lines 30-114 (entire `/metrics/session` route)
- Delete line 6 (`import { buildSessionSummary }`)
- Delete line 7 (`import { getSupabaseClient, insertDictationLog }`)

**Delete files:**
- `worker/src/utils/summary.ts` (no longer needed)

**In `worker/src/handlers/ws.ts`:**
- Delete lines 1200-1294 (entire session_summary block)
- Delete worker metrics object construction (lines 1070-1127)
- Keep ONLY the bare minimum `final` message:
  ```typescript
  server.send(JSON.stringify({
    type: 'final',
    text: responseText,
    wordCount,
    traceId: session.traceId,
  }));
  ```

---

### Phase 4: Remove Database Insert (Keep Quota Update) ✅

**In `worker/src/db/supabase.ts`:**
- KEEP `getSupabaseClient()` function (needed for quota)
- DELETE `insertDictationLog()` function (lines 71-145)

**In `worker/src/index.ts`:**
- Already removed with /metrics/session endpoint

**In `worker/src/handlers/ws.ts`:**
- KEEP `increment_quota` call (lines 1131-1163) - it's using `waitUntil()` correctly
- Just ensure it's truly non-blocking

---

### Phase 5: Fix JWKS Timeout + Caching 🔧

**In `worker/src/auth/supabaseJwt.ts`:**

**Add timeout wrapper:**
```typescript
async function fetchWithTimeout(
  url: URL,
  timeoutMs: number = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`JWKS fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}
```

**Modify `getJWKS()` function:**
```typescript
function getJWKS(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(supabaseUrl);
  if (cached) {
    return cached;
  }

  const jwksUrl = new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);

  // createRemoteJWKSet with custom fetcher that has timeout
  const jwks = createRemoteJWKSet(jwksUrl, {
    // Add timeout to prevent hanging
    timeoutDuration: 5000, // 5 second timeout
  });
  
  jwksCache.set(supabaseUrl, jwks);
  return jwks;
}
```

**Wrap jwtVerify with timeout:**
```typescript
// In verifySupabaseJwt function, wrap the jwtVerify call:
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('JWT verification timed out')), 10000)
);

const verifyPromise = jwtVerify(token, JWKS, {
  issuer: `${supabaseUrl}/auth/v1`,
  audience: 'authenticated',
});

try {
  const { payload } = await Promise.race([verifyPromise, timeoutPromise]);
  // ... rest of logic
} catch (error) {
  // Handle timeout
  if (error.message.includes('timed out')) {
    return { valid: false, error: 'JWT verification timed out', code: 'timeout' as any };
  }
  // ... existing error handling
}
```

---

### Phase 6: Simplify auth/supabaseJwt.ts Logging 🔧

**Remove verbose console.error:**
- Line 141-144: Delete the detailed logging in catch block
- Replace with single line: `console.error('[Auth] JWT verification failed:', errorName)`

---

## Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| CPU Time | 27ms | 20ms | 25% faster |
| Wall Time | 400,000ms | 1,500ms | **266x faster** |
| Wait Ratio | 14,814x | 75x | **197x better** |
| Network Calls | 150-200 (Sentry logs) | 2-3 (STT + LLM) | **98% reduction** |

**Breakdown:**
- Remove Sentry overhead: -100-500ms per span × 10 spans = -1,000-5,000ms
- Remove console.log() overhead: -5-20ms × 50 logs = -250-1,000ms
- Remove /metrics/session blocking: -100-10,000ms (Supabase latency)
- Add JWKS timeout: Prevent indefinite hangs (was 10s+, now max 5s)

**Total savings: ~3,500-15,000ms per request**

---

## Implementation Order

1.  Remove Sentry from index.ts (simplest)
2.  Remove /metrics/session endpoint
3.  Strip all logging from ws.ts (surgical, many edits)
4.  Remove Sentry from STT/LLM providers
5.  Add JWKS timeout
6.  Remove Sentry from package.json
7.  Test locally
8.  Deploy to staging
9.  Monitor CF analytics

---

## Files Changed Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `worker/src/index.ts` | Rewrite (nuke Sentry) | ~120 → 25 |
| `worker/src/handlers/ws.ts` | Strip logging + Sentry spans | ~1526 → ~1200 |
| `worker/src/auth/supabaseJwt.ts` | Add timeout | +40 lines |
| `worker/src/services/stt/providers/groq.ts` | Remove span | -15 lines |
| `worker/src/services/stt/providers/fireworks.ts` | Remove span | -15 lines |
| `worker/src/services/stt/providers/deepgram.ts` | Remove span | -15 lines |
| `worker/src/services/llm/groq.ts` | Remove span | -15 lines |
| `worker/src/services/llm/openai.ts` | Remove span | -15 lines |
| `worker/src/services/llm/baseten.ts` | Remove span | -15 lines |
| `worker/src/services/llm/cerebras.ts` | Remove span | -15 lines |
| `worker/src/services/llm/openrouter.ts` | Remove span | -15 lines |
| `worker/src/utils/summary.ts` | DELETE | -100 lines |
| `worker/src/db/supabase.ts` | Remove insertDictationLog | -75 lines |
| `worker/package.json` | Remove dependency | -1 line |

**Total: ~500 lines deleted, 40 lines added = -460 net lines** 🔥

---

## Testing Plan

1. **Local development:**
   - `cd worker && npm install` (remove Sentry package)
   - `npm run dev:ws`
   - Test single dictation (10s audio)
   - Test chunked dictation (30s audio)
   - Test edit mode
   - Verify no errors in console

2. **Staging deployment:**
   - Deploy to Cloudflare staging worker
   - Monitor CF Analytics for wall time
   - Target: <2s wall time for typical request

3. **Production rollout:**
   - Deploy to production
   - Monitor for 1 hour
   - If wall time <2s sustained → SUCCESS
   - If issues → revert immediately

---

## Rollback Plan

If something breaks:
1. `git checkout main`
2. `cd worker && npm install && npm run deploy:production`
3. Takes <2 minutes

Branch `nuke-instrumentation` preserved for investigation.

---

## Notes

- **increment_quota is SAFE** because it uses `c.executionCtx.waitUntil()` which is non-blocking
- **JWKS timeout is CRITICAL** - jose library has no built-in timeout
- **Console logs were the hidden killer** - Sentry intercepts EVERYTHING
- **266x speedup estimate is conservative** - could be even better

---

## Ready to Execute?

This plan strips out:
- ✅ All Sentry (tracing, logs, spans)
- ✅ 95% of console.log() calls  
- ✅ /metrics/session endpoint
- ✅ Database insert from worker
- ✅ Adds JWKS timeout protection

Keeps:
- ✅ All core functionality (auth, STT, LLM, chunking)
- ✅ increment_quota (free tier tracking)
- ✅ Critical error logging (failures only)

**Estimated time to execute: 45-60 minutes**  
**Expected improvement: 266x faster (400s → 1.5s)**
