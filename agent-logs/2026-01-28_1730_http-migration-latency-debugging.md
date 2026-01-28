# HTTP Migration Latency Debugging & Bug Fixes

**Date:** 2026-01-28
**Agent:** Claude Opus 4.5
**Status:** ⚠️ Partial (latency investigation complete, needs production testing)

## User Intention
User experienced severe latency issues (10-15 seconds) after the WebSocket to HTTP migration, despite server logs showing only ~500ms processing time. They wanted to understand where the delay was coming from and ensure the transcription pipeline was as fast as possible, with nothing blocking the critical path of getting transcribed text back to the user.

## What We Accomplished

### Bug Fixes
- ✅ **Fixed npm scripts using wrong env var** - `package.json` was setting `VITE_TRANSCRIBE_WS_URL` (WebSocket) but code expected `VITE_TRANSCRIBE_URL` (HTTP). This caused `npm run dev:prod` to fall back to localhost.
- ✅ **Fixed JWKS prefetch race condition** - Prefetch was fire-and-forget, so auth middleware ran before cache was warm, causing 1.8s JWKS fetch to Supabase on cold starts.
- ✅ **Fixed transcription history crash** - Corrupted data in electron-store where `text` field contained full object instead of string. Added validation and auto-cleanup.
- ✅ **Fixed blocking post-processing** - `await addTranscription()` and `await insertText()` were blocking `setProcessing(false)`, making UI feel slow. Changed to fire-and-forget.

### Instrumentation Added
- ✅ **Comprehensive client-side timing** - Added timing breakdown for every step: postRoll, recorderStop, prepareWait, authToken, formDataBuild, fetch, responseParse
- ✅ **Auth middleware timing** - Added `authMs` measurement and logging in worker middleware
- ✅ **Server-side upload timing** - Added `uploadMs` to track formData parsing time
- ✅ **API URL logging** - Added debug logs to track which URL (local/prod) is being used

### Investigation Completed
- ✅ **Identified JWKS cold start as main latency culprit** - 1.8s fetch to Supabase when cache is cold
- ✅ **Confirmed Whisper gateway URL was correct** - STT calls were already using gateway (contrary to initial suspicion)
- ✅ **Traced complete data flow** - Mapped client → worker → STT → response path

## Technical Implementation

### JWKS Prefetch Fix
Changed from fire-and-forget to blocking for auth routes:
```typescript
// Before: Race condition
(async () => { await getJWKS(); })(); // Fire-and-forget
await next(); // Auth middleware runs immediately

// After: Wait for cache
if (isAuthRoute && jwksPrefetchPromise) {
  await jwksPrefetchPromise; // Wait for cache to warm
}
await next(); // Auth middleware runs with warm cache
```

### Client-Side Timing Breakdown
```typescript
const timing = {
  stopStarted: Date.now(),
  postRollDone: 0,
  recorderStopped: 0,
  prepareDone: 0,
  authTokenDone: 0,
  fetchStarted: 0,
  fetchDone: 0,
  responseParsed: 0,
};
// ... measure each step and log breakdown
```

### Fire-and-Forget Post-Processing
```typescript
// Before: Blocking
await addTranscription(result.text, mode);
await clipboard.insertText(result.text);
// finally { setProcessing(false) } // UI blocked until these complete

// After: Non-blocking
addTranscription(result.text, mode).then(...).catch(console.warn);
clipboard.insertText(result.text).then(...).catch(console.warn);
// setProcessing(false) runs immediately after setText()
```

**Files Modified:**
- `package.json` - Fixed 6 npm scripts to use `VITE_TRANSCRIBE_URL`
- `src/config/api.ts` - Added debug logging for URL selection
- `src/hooks/useTranscription.ts` - Added comprehensive timing, fire-and-forget post-processing
- `src/components/HistoryItem.tsx` - Added defensive rendering for corrupted data
- `src/lib/transcriptionStorage.ts` - Added validation and auto-cleanup for corrupted entries
- `worker/src/index.ts` - Fixed JWKS prefetch to block for auth routes
- `worker/src/middleware/auth.ts` - Added auth timing measurement
- `worker/src/handlers/http.ts` - Added uploadMs timing, use authMs from middleware
- `worker/src/utils/sessionLogger.ts` - Added upload_ms field
- `worker/src/utils/analytics.ts` - Added upload_ms to Analytics Engine (double16)

## Bugs & Issues Encountered

1. **npm scripts using wrong env var**
   - **Symptom:** `npm run dev:prod` connected to localhost:8787 instead of production
   - **Root cause:** HTTP migration didn't update package.json from `VITE_TRANSCRIBE_WS_URL` to `VITE_TRANSCRIBE_URL`
   - **Fix:** Updated all 6 affected npm scripts

2. **JWKS prefetch race condition**
   - **Symptom:** First request took 1.8s extra for `/auth/v1` call
   - **Root cause:** Prefetch was fire-and-forget, auth middleware didn't wait
   - **Fix:** Store prefetch promise, await it for auth routes before proceeding

3. **Transcription history panel crash**
   - **Symptom:** React error "Objects are not valid as a React child"
   - **Root cause:** Corrupted data in electron-store from buggy save during migration
   - **Fix:** Added validation layer that auto-cleans corrupted entries on load

4. **Auth timing not captured**
   - **Symptom:** `auth_ms = 0` in all logs despite auth taking time
   - **Root cause:** Handler timing started AFTER auth middleware completed
   - **Fix:** Measure time in middleware, pass `authMs` via auth context

## Key Learnings

- **JWKS caching is critical** - Without proper edge caching, every cold start pays 500ms-1.8s to fetch from Supabase. The in-memory cache only helps within a single worker instance.

- **Fire-and-forget races are dangerous** - The JWKS prefetch "optimization" actually caused worse latency because it didn't wait. Blocking prefetch for auth routes is better.

- **Migration checklists needed** - The WS→HTTP migration missed updating env var names, causing confusing local/prod behavior. Future migrations should include a checklist of all config touchpoints.

- **Middleware timing is invisible** - Hono middleware runs before handler timing starts. Must explicitly measure and pass timing from middleware to handler.

- **Corrupted data survives** - Electron-store persists across app restarts. Buggy saves during development can cause crashes later. Defensive validation on read is important.

## Architecture Decisions

- **Keep auth on both /prepare and /transcribe** - Security requirement. Without auth on /transcribe, users could bypass /prepare and get free transcriptions. The latency cost (~10-30ms with warm cache) is acceptable.

- **Fire-and-forget for non-critical operations** - `addTranscription()` and `insertText()` don't need to block UI. User sees text immediately, background operations complete async.

- **Block prefetch for auth routes only** - Health check (`/`) shouldn't wait for JWKS. Only `/prepare` and `/transcribe` need auth, so only they wait.

## Ready for Next Session

- ✅ **Timing instrumentation in place** - Console shows full breakdown of where time goes
- ✅ **Auth timing visible** - Worker logs show `[Auth] JWT verification completed in Xms`
- 🔧 **Needs production testing** - Deploy worker changes, test cold start latency
- 🔧 **Monitor JWKS cache effectiveness** - Watch for "JWKS from edge cache" vs "JWKS cache miss" logs

## Context for Future

This session debugged the HTTP migration's latency issues. The main culprit was JWKS cold start (1.8s) which is now fixed. With warm caches, the full E2E latency is ~868ms (mostly STT time). Future work should focus on:
1. Monitoring production cold start frequency
2. Potentially pre-warming workers with scheduled pings
3. Considering signed prepareId to skip full JWT verification in /transcribe (if auth latency becomes an issue again)

The codebase now has comprehensive timing instrumentation to diagnose any future latency issues.
