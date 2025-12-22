# Remove Noisy Console Logging & Migrate to Wide Events

**Date:** 2025-12-22  
**Agent Session:** Comprehensive logging cleanup + ClientSessionEventBuilder migration  
**Branch:** `logging-sucks`  
**Status:** ✅ Complete

---

## User Intention

Remove all noisy, redundant console logging (30+ logs per transcription) and migrate to the "Wide Events / Canonical Log Lines" philosophy from https://loggingsucks.com/. Replace scattered logs with a single structured event per session using the existing `ClientSessionEventBuilder` pattern. The goal: ONE log per transcription with full context, no noise.

Key motivation: Console was spammed with quota updates, state changes, device enumeration, etc. that provided zero debugging value. The user wanted clean, actionable logs following wide event principles.

---

## What We Accomplished

### ✅ Phase 1: Noise Removal (Screen/Display/State Logging)
- [x] **Display/screen logs** - Removed `[FollowCursor]`, `[DisplayChange]`, `logBounds()` (7 locations in main.ts)
- [x] **App.tsx** - Removed `[Reducer] Dispatching` log, `[PillWidth]` log, dead `notchDecisionLogRef`
- [x] **Pill.tsx** - Removed `[Pill] State:` log, unused state variables
- [x] **QuotaCache** - Removed all 6 console.log statements (fired every transcription)
- [x] **UserIdentity** - Removed 3 console.log statements (startup/cache noise)
- [x] **TranscriptionHistory** - Removed `[TranscriptionHistory] Loaded` log
- [x] **MicDevices** - Removed all 4 console.log statements
- [x] **useTranscription.ts** - Removed/gated 15+ ungated logs (auth, devices, mic, selection)

### ✅ Phase 2: Wide Event Migration
- [x] **Renamed log prefix** - `[ClientSession]` → `[Session]` (removed "SF" legacy naming)
- [x] **Added ClientSessionEventBuilder import** - Integrated existing builder from clientSessionLogger.ts
- [x] **Created sessionEventRef** - Added ref to track builder throughout session lifecycle
- [x] **Initialize builder on session start** - Create new builder with session ID and mode
- [x] **Populate timing metrics** - Called setTiming() with all client-side timestamps
- [x] **Populate audio metrics** - Called setAudioMetrics() with frames/bytes
- [x] **Populate server metrics** - Called setServerMetrics() with stt_ms/llm_ms from worker
- [x] **Emit success outcome** - Called setOutcome('success') with text/wordCount
- [x] **Emit error outcomes** - Added error emission on server errors and exceptions
- [x] **Removed old [SF] E2E log** - Deleted manual breakdown object construction

### ✅ Phase 3: GPT Review Fixes
- [x] **Fixed worker metrics** - Removed nonexistent `worker_lifetime_ms` and `audio_streaming_ms` fields
- [x] **Gated OCR log** - Put `[OCR] Screenshot captured...` behind `devConsoleLogs`
- [x] **Improved error mapping** - Map errors to specific outcomes (auth/timeout/network/ws/unknown)
- [x] **Removed stt_ms fallback** - No longer falls back to `statusToFinalRecvMs` (client timing)
- [x] **Rounded llm_ms** - Consistent rounding with stt_ms (integer milliseconds)

**Total Impact:**
- ~40 noisy log statements removed
- ~15 debug logs gated behind `SF_DEVTOOLS=1`
- From **30+ log lines per transcription** → **1 wide event per transcription**

---

## Bugs Found & Fixed

### 🐛 Bug: setReady() Logic Moved Inside devConsoleLogs Gate
**What happened:** During cleanup of audio settings logs, accidentally moved `setReady(true)` and `return true` inside the `if (window.devFlags?.devConsoleLogs)` gate, breaking microphone initialization when debug logs were off.

**Fix:** Moved `setReady()` and `return` back outside the conditional gate so they always execute.

**File:** `src/hooks/useTranscription.ts` lines 1097-1121

### 🐛 Bug: Type Errors with ClientSessionOutcome
**What happened:** Used error outcome types (`error_quota`, `error_stt`, `error_llm`) that don't exist in the `ClientSessionOutcome` type definition.

**Fix:** Simplified error mapping to only use defined types: `error_auth`, `error_timeout`, `error_network`, `error_ws_failed`, `error_unknown`.

**File:** `src/hooks/useTranscription.ts` lines 1913-1926

---

## Key Learnings & Decisions

1. **Wide Events vs Scattered Logs**  
   The codebase had the RIGHT pattern (`ClientSessionEventBuilder`) but wasn't using it. The old `[SF] E2E` log was a proto-wide-event that we replaced with the proper builder.

2. **devConsoleLogs Flag Strategy**  
   - Most VAD/selection logs were already gated behind `window.devFlags?.devConsoleLogs`
   - The problem was ungated logs in quota/state/startup code
   - `SF_DEVTOOLS=1` is set in dev scripts, making those gated logs visible during development

3. **What to Keep vs Remove**  
   - **Remove:** Logs that provide zero debugging value (state transitions visible in UI, cache updates, startup noise)
   - **Gate:** Logs useful for specific debugging (VAD events, audio settings, selection snapshots, OCR timing)
   - **Keep:** The wide event (`[Session]`), error logs (`console.error/warn`)

4. **Metric Trustworthiness**  
   - Never fallback to client-side calculations when server data is unavailable
   - Better to emit `undefined` than emit misleading metrics
   - Round all timing values consistently (integer milliseconds)

5. **Log Prefix Matters**  
   Changed from `[SF] E2E` to `[Session]` - cleaner, no legacy baggage. "SF" referred to old "Sonic Flow" name.

6. **Worker Payload Structure**  
   The worker sends `metrics.worker` with `stt.totalMs` and `llm.totalMs`, but does NOT send `workerLifetimeMs` or `audioStreamingMs`. Only map fields that actually exist.

---

## Context for Future Sessions

### Current State
- Console is now clean with **1 log per transcription**: `[Session]` wide event
- All debug logs properly gated behind `SF_DEVTOOLS=1`
- `ClientSessionEventBuilder` fully integrated and emitting on both success and error
- Metrics are trustworthy (no misleading fallbacks)

### Log Structure
```typescript
// Success case
[Session] {
  trace_id: "abc123",
  mode: "dictation",
  outcome: "success",
  timing: { pttDownMs, wsOpenMs, ... },
  audio: { frames, bytes, ... },
  server: { stt_ms, llm_ms },
  result: { text, wordCount }
}

// Error case
[Session] {
  trace_id: "abc123",
  outcome: "error_network",
  error: { message, type }
}
```

### Next Steps (Not Done)
1. **Turn off SF_DEVTOOLS by default** - Remove `SF_DEVTOOLS=1` from `package.json` dev scripts for clean logs by default
2. **Add OCR timing to wide event** - OCR capture timing is currently gated, could be added to session metrics
3. **Add error outcome types** - Consider adding `error_stt` and `error_llm` to `ClientSessionOutcome` type for more granular error tracking

### Files to Watch
- `src/hooks/useTranscription.ts` - Main transcription hook, wide event emitted around line ~1890
- `src/utils/clientSessionLogger.ts` - Wide event builder and emission logic
- `src/state/quotaCache.ts` - Now clean, no logs
- `src/components/App.tsx` - Now clean, no reducer spam

### Related Documents
- `https://loggingsucks.com/` - Philosophy that guided this cleanup
- Wide events = high cardinality (trace_id) + high dimensionality (30+ fields)

---

## Code Changes Summary

**Modified Files:**
- `src/main.ts` - Removed display/bounds logging (7 locations)
- `src/components/App.tsx` - Removed reducer logging + notch width spam + dead ref
- `src/components/Pill.tsx` - Removed state logging + unused variables
- `src/hooks/useTranscription.ts` - Complete wide event migration:
  - Added ClientSessionEventBuilder import and ref
  - Initialize builder on session start
  - Populate timing/audio/server metrics throughout session
  - Emit on success with text/wordCount
  - Emit on errors with specific outcomes
  - Removed old manual [SF] E2E log construction
  - Fixed stt_ms fallback (no client timing)
  - Rounded llm_ms consistently
  - Gated OCR log behind devConsoleLogs
  - Removed nonexistent worker fields
- `src/state/quotaCache.ts` - Removed all 6 console logs
- `src/state/userIdentity.ts` - Removed 3 console logs
- `src/state/transcriptionHistory.ts` - Removed loaded count log
- `src/utils/micDevices.ts` - Removed all 4 console logs + unused param
- `src/utils/clientSessionLogger.ts` - Changed prefix to `[Session]`, standardized `setServerMetrics` params

**Lines Changed:** ~150 lines modified/removed across 11 files

**Result:**
- Before: 30+ log lines per transcription
- After: 1 wide event per transcription
- All debug logs properly gated
- Production-ready metrics (no misleading fallbacks)
- Sentry integration on failures

