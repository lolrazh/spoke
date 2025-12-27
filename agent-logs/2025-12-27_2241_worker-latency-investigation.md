# Worker Latency Investigation & Dead Code Cleanup

**Date**: 2025-12-27
**Time**: 22:41 IST
**Agent**: Claude Sonnet 4.5
**Status**: ✅ Investigation Complete, 🔧 Awaiting Production Testing

## User Intention

User discovered a massive latency discrepancy: Worker code measured 6292ms for a Groq STT request while Cloudflare AI Gateway reported only 317ms for the same request. This ~6000ms gap occurred even locally, ruling out geographic network issues. They suspected December's rapid refactoring (smart routing, consolidated logging, WebSocket fixes) introduced blocking code or overhead. The deeper goal was to identify the root cause and clean up any technical debt from the rushed December work that might be contributing to the problem.

## What We Accomplished

- ✅ **Comprehensive Worker code investigation** - Launched 4 parallel agents to analyze ws.ts (blocking operations), smart routing (overhead), auth/DB (blocking writes), and dead code scanning
- ✅ **Ruled out Worker code blocking** - All agents confirmed no blocking operations on critical path: DB/analytics use waitUntil(), logging is fire-and-forget, smart routing is pure sync code (<5ms)
- ✅ **Dead code cleanup** - Removed 4 sources of technical debt from incomplete December refactoring
- ✅ **Granular STT timing instrumentation** - Added detailed breakdowns to Groq and Simplismart providers to identify where latency occurs
- ✅ **Fixed Simplismart unit bug** - Corrected request_time conversion from seconds to milliseconds (was treating 0.037s as 0.037ms)
- ✅ **Added CF datacenter logging** - Shows which Cloudflare colo serves each request to understand geographic routing
- ✅ **Researched CF observability** - Comprehensive guide on accessing Worker logs and AI Gateway analytics

## Technical Implementation

### 1. Granular Timing Instrumentation

**File**: `worker/src/services/stt/providers/groq.ts`

Added timing breakdown to identify where 6000ms is spent:

```typescript
// Line 37-46: FormData creation timing
const formStartAt = Date.now();
const form = new FormData();
const file = new File([wav], "audio.wav", { type: "audio/wav" });
// ... append fields ...
const formCreationMs = Date.now() - formStartAt;

// Line 61-70: Fetch timing
const fetchStartAt = Date.now();
const res = await fetch(GROQ_STT_ENDPOINT, { ... });
const headersAt = Date.now();
const fetchTtfbMs = headersAt - fetchStartAt;

// Line 87-99: Comprehensive logging
console.log(`[STT:Groq] Latency breakdown:`, {
  audio_size_kb: (wav.length / 1024).toFixed(2),
  timings: {
    form_creation_ms: formCreationMs,      // File/FormData object creation
    fetch_ttfb_ms: fetchTtfbMs,            // DNS + TCP + TLS + upload + server
    body_read_ms: bodyReadMs,              // Response download + JSON parse
    total_fetch_ms: totalFetchMs,          // Excludes form creation
    total_ms: totalMs                      // Everything
  }
});
```

**Expected Behavior**:
- `form_creation_ms`: <10ms (should be fast)
- `fetch_ttfb_ms`: This should match or exceed AI Gateway duration
- `body_read_ms`: <100ms (small response)
- If `fetch_ttfb_ms >> AI Gateway duration`: Network overhead (DNS/TCP/TLS/upload)

### 2. Simplismart Unit Conversion Fix

**File**: `worker/src/services/stt/providers/simplismart.ts` (lines 146-148)

**Before**:
```typescript
server_reported_time_ms: json.request_time ?? null, // WRONG: 0.037 treated as 0.037ms
estimated_network_overhead_ms: ttfb - (json.request_time ?? 0), // WRONG
```

**After**:
```typescript
// NOTE: Simplismart API returns request_time in SECONDS (e.g., 0.037 = 37ms)
server_reported_time_ms: json.request_time != null ? json.request_time * 1000 : null,
estimated_network_overhead_ms: ttfb - ((json.request_time ?? 0) * 1000),
```

**Impact**: Previous logs showed `estimated_network_overhead_ms: 1504ms` when it should have been `1468ms` (1505ms - 37ms).

### 3. CF Datacenter Logging

**File**: `worker/src/handlers/ws.ts` (lines 186-188)

```typescript
// Log CF datacenter (colo) to understand geographic routing
const cfColo = (c.req.raw as any).cf?.colo ?? "unknown";
console.log(`[WS] Connection from ${clientIP}, CF colo: ${cfColo}`);
```

**Purpose**: Identify if Worker is running in expected region (HYD = Hyderabad, SIN = Singapore, IAD = US East, etc.)

### 4. Dead Code Removed

| File | Lines | What Was Removed | Why It Was Dead |
|------|-------|------------------|-----------------|
| `worker/src/ws/session.ts` | 14-22, 46-48 | `ChunkState` type, `chunkStates` Map, `currentChunkIndex`, `pendingChunkSTT` Set | Chunking removed in December but state allocation left behind - wasted memory every session |
| `worker/src/db/supabase.ts` | 1-43 (entire file) | `getSupabaseClient()`, cached client singleton | Never called anywhere, Worker uses raw fetch() to Supabase |
| `worker/src/utils/analytics.ts` | 151-224 | `trackEvent()`, `trackTiming()` functions | Marked deprecated, never called, only used internally |
| `worker/src/services/llm/triggers.ts` | 100 | `private listCandidates: ListCandidate[]` | Property declared but never read or written |

**Files Modified:**
- `worker/src/services/stt/providers/groq.ts` - Added granular timing instrumentation
- `worker/src/services/stt/providers/simplismart.ts` - Fixed request_time unit conversion
- `worker/src/handlers/ws.ts` - Added CF colo logging
- `worker/src/ws/session.ts` - Removed unused chunking state
- `worker/src/db/supabase.ts` - Deleted entire file
- `worker/src/utils/analytics.ts` - Removed deprecated functions (74 lines)
- `worker/src/services/llm/triggers.ts` - Removed unused property

## Bugs & Issues Encountered

### 1. Simplismart request_time Unit Misinterpretation
- **Symptom**: Logs showed `server_reported_time_ms: 0.037` and calculated massive network overhead
- **Root Cause**: Simplismart API returns `request_time` in **seconds** (e.g., 0.037 = 37ms), not milliseconds
- **Fix**: Multiply by 1000 before using: `json.request_time * 1000`
- **Impact**: Previous instrumentation in agent-logs/2025-12-27_1730_network-latency-diagnosis-architecture.md had incorrect calculations

### 2. Unused Chunking State Memory Waste
- **Symptom**: Every WebSocket session allocated `Map` and `Set` objects that were never accessed
- **Root Cause**: December commit removed transcription chunking but left state allocation in `createEmptySession()`
- **Fix**: Removed `ChunkState` type and all chunking properties from session object
- **Impact**: Small memory leak per connection (insignificant but sloppy)

### 3. Orphaned Supabase Client Module
- **Symptom**: `/worker/src/db/supabase.ts` exported `getSupabaseClient()` but had zero call sites
- **Root Cause**: Worker switched to raw `fetch()` calls to Supabase REST API, never refactored module away
- **Fix**: Deleted entire file
- **Impact**: None (already dead code)

### 4. Pre-existing Test Failure (Not Fixed)
- **Symptom**: `worker/src/config/runtime.test.ts:9` expects `cfg.llm.stream` to be `true` but defaults to `false`
- **Root Cause**: Config default changed but test not updated
- **Status**: Left unfixed (pre-existing, unrelated to this work)

## Investigation Findings

### Agent Reports Summary

4 parallel agents investigated different areas:

| Agent | Focus Area | Finding |
|-------|------------|---------|
| ws.ts blocking ops | WebSocket handler critical path | ✅ No blocking operations - all DB/analytics use `waitUntil()`, logging is fire-and-forget |
| Smart routing overhead | Trigger detection & routing logic | ✅ All operations sync, <5ms total - regex is fast, no async calls |
| Auth/DB blocking | JWT verification, Supabase writes, Analytics Engine | ✅ JWT before audio (correct), quota increment after response (waitUntil), Analytics sync queue |
| Dead code scan | Unused code, redundant ops, December churn | ⚠️ Found 4 dead code issues, 6 LLM provider copy-paste duplication, verbose logging |

**Conclusion**: Worker code architecture is solid. No blocking operations on critical path. The 6000ms overhead is NOT in the Worker code itself.

### Critical Path Timeline (Confirmed Clean)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. WebSocket connect                                        │
│ 2. auth message → verifySupabaseJwt() [BLOCKING pre-audio] │
│ 3. auth_ok sent                                             │
│ 4. start message                                            │
│ 5. Audio frames stream in (buffered)                        │
│ 6. end message                                              │
│    └─ CRITICAL PATH STARTS ─────────────────────────────────│
│       7. concat() + wrapWav() [sync, ~0-5ms]                │
│       8. transcribeWav() [STT API call, INSTRUMENTED NOW]   │
│       9. (optional) chatComplete() [LLM, instrumented]      │
│    └─ CRITICAL PATH ENDS ───────────────────────────────────│
│10. server.send({ type: "final", text: ... })                │
│11. await 100ms delay (intentional, Cloudflare flush)        │
│12. safeClose()                                              │
├─────────────────────────────────────────────────────────────┤
│ AFTER RESPONSE (fire-and-forget, non-blocking):            │
│ • trackSessionLifecycle() [sync Analytics Engine queue]    │
│ • waitUntil(quotaIncrement()) [async, doesn't block]       │
│ • console.log(session_summary) [sync, ~0ms]                │
└─────────────────────────────────────────────────────────────┘
```

## Key Learnings

### 1. Worker Code Is Not The Problem
After comprehensive investigation, the Worker architecture is sound:
- All database writes use `c.executionCtx.waitUntil()` (fire-and-forget)
- Analytics Engine `writeDataPoint()` is synchronous queue operation (no I/O)
- Console logging is fire-and-forget (no await)
- Smart routing is pure synchronous code (<5ms)
- No race conditions or blocking awaits found

### 2. AI Gateway Timing vs Worker Timing
**Critical Distinction**: AI Gateway duration measures **gateway perspective only**, which excludes:
- DNS lookups (100-500ms on cold start)
- TCP/TLS handshake (1-3 RTT = 200-600ms for distant servers)
- Cloudflare infrastructure queuing
- Request upload time (depends on payload size and TCP slow start)

**Expected Relationship**:
```
Worker fetch_ttfb_ms ≥ AI Gateway duration
Delta = DNS + TCP + TLS + upload overhead + CF queuing
```

If Worker shows 6292ms but Gateway shows 317ms, the 5975ms is happening **before** the request reaches the gateway.

### 3. Cloudflare Workers Don't Expose Granular Network Timing
The Fetch API in Workers only provides:
- When `fetch()` is called
- When response headers arrive
- When response body completes

Cannot distinguish between:
- DNS resolution time
- TCP handshake time
- TLS handshake time
- Request upload time
- Server processing time (unless API returns it, like Simplismart does)

Must infer network overhead by subtracting server-reported time from TTFB.

### 4. December Refactoring Left Technical Debt
The git log shows 150+ commits in December with frequent provider switching and configuration changes. Evidence of rushed work:
- Chunking removal incomplete (state objects left behind)
- Dead Supabase module not cleaned up
- Deprecated analytics functions not removed
- 6 LLM providers with copy-paste code (should be abstracted)

### 5. FormData Creation Should Be Fast
Creating `new File([Uint8Array], "audio.wav")` and appending to `FormData` is synchronous in Workers. Should complete in <10ms. If `form_creation_ms` shows high values (>100ms), there's a Workers runtime issue.

### 6. Date.now() Precision Is 1ms
JavaScript's `Date.now()` has 1ms precision. Measurements like "base64_encode_ms: 0" don't mean it took 0ms, just <1ms. Fine for measuring network operations (hundreds of ms) but not CPU-bound operations.

## Architecture Decisions

### 1. Provider-Level Instrumentation Over Generic Wrapper
**Decision**: Add timing to each provider (Groq, Simplismart) individually rather than wrapping the dispatcher.

**Rationale**:
- Each provider has unique characteristics (FormData vs JSON body, different response formats)
- Simplismart returns `request_time`, Groq doesn't - need provider-specific calculations
- Allows tracking provider-specific metrics (base64 encoding for Simplismart, form creation for Groq)

**Trade-off**: More code duplication, but better visibility into each provider's behavior.

### 2. Console.log Over Structured Telemetry
**Decision**: Use `console.log()` with JSON objects rather than OpenTelemetry or custom telemetry system.

**Rationale**:
- Works with `wrangler tail` for real-time debugging
- No dependencies or complexity
- Cloudflare Workers Logs automatically parse JSON
- Can export to external systems later if needed

**Trade-off**: Less structured than OTLP, but simpler and faster to implement.

### 3. Clean Up Dead Code Now vs Later
**Decision**: Remove all dead code immediately even though not causing latency.

**Rationale**:
- Prevents future confusion ("is this code used?")
- Reduces cognitive load when reading codebase
- Unused Map/Set allocation per session is sloppy
- Clean codebase makes future debugging easier

**Trade-off**: Small risk of breaking something if code was actually used (verified not used via grep).

## How to Verify Instrumentation

### Access Worker Logs (Real-time):
```bash
cd worker
npx wrangler tail --format pretty
```

### Expected Log Output:

**1. Connection Log:**
```
[WS] Connection from 103.x.x.x, CF colo: HYD
```
Shows which Cloudflare datacenter serves the request (HYD = Hyderabad, SIN = Singapore, IAD = US East, etc.)

**2. Groq Timing Breakdown:**
```json
[STT:Groq] Latency breakdown: {
  "audio_size_kb": "72.34",
  "timings": {
    "form_creation_ms": 2,        // Should be <10ms
    "fetch_ttfb_ms": 6292,        // MYSTERY VALUE - where is 6000ms going?
    "body_read_ms": 56,           // Should be <100ms
    "total_fetch_ms": 6348,       // fetch_ttfb + body_read
    "total_ms": 6350              // Everything from function entry
  }
}
```

**3. Simplismart Timing Breakdown:**
```json
[STT:Simplismart] Latency breakdown: {
  "audio_size_kb": "195.23",
  "base64_size_kb": "260.31",
  "timings": {
    "base64_encode_ms": 12,
    "ttfb_ms": 1505,
    "body_read_ms": 56,
    "total_ms": 1561
  },
  "server_reported_time_ms": 37,              // Now correctly converted from 0.037s
  "estimated_network_overhead_ms": 1468       // ttfb - server_time
}
```

### Access AI Gateway Analytics:

**Dashboard**: Cloudflare → AI → AI Gateway → [spoke] → Analytics tab

**Compare**:
- **Worker `fetch_ttfb_ms`** vs **AI Gateway `duration`**
- If Worker shows 6292ms but Gateway shows 317ms → 5975ms is happening before the gateway (DNS, TCP, TLS, queuing, upload)

### Correlation:

Use the same `trace_id` to correlate:
- Worker `[STT:Groq]` logs
- Worker `[STT:Simplismart]` logs
- Worker session summary (`transcription.session_summary`)
- AI Gateway request logs
- Analytics Engine records

## Ready for Next Session

- ✅ **Instrumentation complete** - Groq and Simplismart providers log detailed timing breakdown
- ✅ **Dead code removed** - Cleaner codebase with 4 areas of technical debt eliminated
- ✅ **Unit bug fixed** - Simplismart `request_time` now correctly converted to milliseconds
- ✅ **CF colo logging added** - Can verify which datacenter serves requests
- ✅ **Observability guide compiled** - Comprehensive instructions for accessing Worker logs and AI Gateway analytics
- 🔧 **Need production deployment** - Changes must be deployed to capture real timing data
- 🔧 **Need production logs** - Must run test transcription and analyze logs via `wrangler tail`
- 🔧 **Root cause still unknown** - 6000ms discrepancy not yet explained, awaiting instrumentation data

## Context for Future

This session established comprehensive instrumentation to identify where the mysterious 6000ms latency is occurring in the STT pipeline. The investigation definitively ruled out Worker code blocking as the cause - all agents confirmed the architecture is sound with proper async/await patterns and fire-and-forget operations for DB/analytics.

The next session should deploy these changes to production, capture logs via `wrangler tail`, and compare the Worker's granular timing breakdown with AI Gateway analytics. The key metric to watch is `fetch_ttfb_ms` in the Groq logs:

- If **`form_creation_ms` is high (>1000ms)**: FormData/File APIs in Workers are slow (runtime issue)
- If **`fetch_ttfb_ms` is high but AI Gateway shows low**: Network overhead (DNS/TCP/TLS/upload) is the bottleneck
- If **both are small**: Time is lost somewhere else (queuing, proxy, etc.)

The instrumentation will reveal exactly where the 6000ms is being spent, enabling targeted optimization (Fly.io proxy, connection pooling, provider change, etc.).

## Related Work

This session builds on:
- `agent-logs/2025-12-27_1530_simplismart-latency-instrumentation.md` - Initial instrumentation attempt (timestamp bug)
- `agent-logs/2025-12-27_1730_network-latency-diagnosis-architecture.md` - Root cause analysis and architecture options
- `agent-logs/2025-12-25_1355_smart-llm-routing.md` - Smart routing implementation (suspected culprit, ruled out)
- `agent-logs/2025-12-18_2200_consolidated-logging.md` - Consolidated logging pattern
- `agent-logs/2025-12-26_2200_websocket-timeout-debugging.md` - WebSocket state corruption fix

## Next Steps

1. **Deploy Worker changes**:
   ```bash
   cd worker
   npx wrangler deploy
   ```

2. **Start log streaming**:
   ```bash
   npx wrangler tail --format pretty
   ```

3. **Run test transcription** and observe:
   - `[WS] Connection from X, CF colo: Y` - Verify datacenter
   - `[STT:Groq] Latency breakdown` - Identify where 6000ms is spent
   - `[STT:Simplismart] Latency breakdown` - Verify correct server_time calculation

4. **Compare with AI Gateway** dashboard to see if discrepancy is explained

5. **Based on findings**:
   - If network overhead → Implement Fly.io proxy or switch provider
   - If FormData creation → Report Workers runtime issue
   - If unexplained → Investigate Cloudflare infrastructure queuing
