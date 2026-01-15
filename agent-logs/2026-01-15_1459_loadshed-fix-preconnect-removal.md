# Cloudflare LoadShed Fix: PreConnect Removal

**Date:** 2026-01-15  
**Agent:** Gemini  
**Status:** ✅ Completed  

## User Intention
User was experiencing frequent transcription failures with zero visibility into why they were happening. Production latency was 1-2 seconds vs 200ms locally. After enabling Cloudflare observability traces, we discovered `loadShed` outcomes on WebSocket connections that were staying open for 12+ minutes. The goal was to diagnose the root cause and fix the reliability issues.

## What We Accomplished
- ✅ **Diagnosed loadShed root cause** - Identified that `preConnect()` was opening WebSocket connections on app startup that sat idle for minutes until Cloudflare killed them
- ✅ **Removed preConnect calls** - Eliminated the two preConnect invocations from App.tsx that were causing long-lived idle connections
- ✅ **Enabled Cloudflare traces** - Added `traces.enabled: true` to wrangler.jsonc for better observability
- ✅ **Added worker boot timing** - Added `workerBootedAt` metric to measure cold start overhead
- ✅ **Updated documentation** - Reflected architectural change from pre-connect to parallel auth in TRANSCRIPTION.md
- ✅ **Evaluated Effect TS** - Conducted audit of codebase suitability; concluded current refactoring is sufficient

## Technical Implementation

### The Problem
From Cloudflare traces, we observed connections like:
```json
{
  "outcome": "loadShed",
  "wall_time_ms": 208446,  // 3.5 minutes
  "cpu_time_ms": 8         // Only 8ms of actual work
}
```

The `preConnect()` function in `useTranscription.ts` was being called on app startup and after sign-in. It opened a WebSocket, authenticated, then left it open indefinitely waiting for dictation. Cloudflare was loadShedding these idle connections.

### The Solution
Since parallel auth was already implemented (2025-12-20), preConnect is no longer needed. Auth now runs in a background thread while recording starts immediately:
- Thread 1: Start recording immediately (UI responsive)
- Thread 2: Open WebSocket + auth (10-50ms with JWKS cache)

Connection lifetime is now only during actual transcription (2-10 seconds), not app lifetime.

**Files Modified:**
- `src/components/App.tsx` - Removed 2 preConnect calls and unused retryWithBackoff import
- `worker/wrangler.jsonc` - Added `"traces": { "enabled": true }`
- `worker/src/pipeline/types.ts` - Added `workerBootedAt` to TimingMetrics
- `worker/src/handlers/ws.ts` - Capture boot timestamp on function entry, include in session logging
- `worker/src/utils/sessionLogger.ts` - Added `worker_boot_ms` to SessionCompleteLog
- `docs/TRANSCRIPTION.md` - Updated architecture description to reflect parallel auth

## Bugs & Issues Encountered
1. **LoadShed on idle WebSocket connections** - Cloudflare was killing connections open for 3-12 minutes
   - **Root Cause:** `preConnect()` opened connections on app startup that sat idle
   - **Fix:** Removed preConnect calls; connections now only open when user dictates

2. **Zero visibility into connection lifecycle** - No way to see why transcriptions were failing
   - **Fix:** Enabled Cloudflare traces in wrangler.jsonc

## Key Learnings
- **Cloudflare Workers expect short-lived connections** - Long-lived idle WebSockets are prime targets for loadShed, especially in busy data centers
- **Pre-connect optimization became redundant** - Once parallel auth was implemented (2025-12-20), pre-connecting provided minimal benefit but introduced reliability issues
- **8ms CPU time over 12 minutes = target for loadShed** - Cloudflare's load balancing sees these as holding resources hostage
- **Effect TS audit conclusion** - Current refactoring (modular pipeline, ConnectionContext, lazy loading) already solves 70% of what Effect would provide; not worth the migration cost now

## Architecture Decisions
- **Remove preConnect vs add idle timeout** - Chose to remove entirely because parallel auth makes it unnecessary; simpler is better
- **Keep preConnect function in hook** - Left the function defined for potential future use, just removed the calls; minimizes code churn
- **Parallel auth over pre-auth** - Recording starts immediately, auth happens in background; user never perceives delay

## Ready for Next Session
- ✅ **Traces enabled** - Cloudflare dashboard will now show detailed timing for all requests
- ✅ **Boot timing available** - `worker_boot_ms` metric in logs to identify cold start overhead
- 🔧 **Deploy to production** - Changes need to be deployed and monitored for loadShed resolution
- 🔧 **Monitor first-dictation latency** - Verify that parallel auth provides acceptable first-dictation experience

## Context for Future
The preConnect optimization was a holdover from before parallel auth was implemented. With parallel auth, the first dictation has minimal perceived latency (auth completes in 10-50ms while user starts speaking). This fix should eliminate loadShed errors and improve overall reliability. Monitor Cloudflare traces after deployment to confirm connection lifetimes are now in the 2-10 second range instead of minutes.

**Related logs:**
- `2025-12-20_2235_parallel-auth-recording.md` - When parallel auth was implemented
- `2025-12-28_1445_architectural-review-worker-refactoring-needed.md` - Previous latency investigation
- `2025-12-29_0030_worker-refactoring-complete.md` - Modular pipeline architecture
