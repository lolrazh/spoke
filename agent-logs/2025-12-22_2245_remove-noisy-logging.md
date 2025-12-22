# Remove Noisy Console Logging

**Date:** 2025-12-22  
**Agent Session:** Comprehensive logging cleanup following "Wide Events" principles  
**Branch:** `logging-sucks`

---

## User Intention

Remove all noisy, redundant console logging that was spamming the console (30+ logs per transcription). The goal was to eliminate dead code following the "Wide Events / Canonical Log Lines" philosophy from https://loggingsucks.com/ - keep only the single wide event that captures the full session context.

Key motivation: The user was seeing massive console spam on every dictation (quota updates, state changes, device enumeration, etc.) that provided zero debugging value and cluttered the actual useful logs.

---

## What We Accomplished

### ✅ Phase 1: Screen/Display Logging Cleanup
- [x] Removed `[FollowCursor] Display changed` log (fired on every cursor movement between screens)
- [x] Removed `[DisplayChange]` sync log (fired on display events)
- [x] Removed `logBounds()` function and all 6 call sites (fired on window moves)
- [x] Removed `[Display] active=...` log in App.tsx (fired on every cursor movement)
- [x] Removed `[PillWidth] base=...` log (fired on every width change)
- [x] Removed dead `notchDecisionLogRef` ref

### ✅ Phase 2: Per-Session/State Logging Cleanup  
- [x] **QuotaCache** - Removed 6 console.log statements (fired on every transcription + startup)
- [x] **App.tsx** - Removed `[Reducer] Dispatching` log (fired 6+ times per session)
- [x] **Pill.tsx** - Removed `[Pill] State:` log (fired on every state change)
- [x] **userIdentity.ts** - Removed 3 console.log statements (startup + cache update noise)
- [x] **transcriptionHistory.ts** - Removed `[TranscriptionHistory] Loaded` log (startup noise)
- [x] **micDevices.ts** - Removed 4 console.log statements (startup + device change noise)
- [x] **useTranscription.ts** - Removed/gated 15+ ungated logs:
  - Removed: Auth message sent/successful (per-session noise)
  - Removed: STT prompt logs (redundant)
  - Removed: WS endpoint log (one-time info, not needed per-connection)
  - Removed: Pre-connect success log
  - Removed: Audio device enumeration log
  - Removed: Mic selection changed log
  - Removed: Microphone stream opened log
  - Removed: Transcribe/LLM processing started logs (redundant with wide event)
  - Gated behind `devConsoleLogs`: Audio track settings/capabilities, AudioContext info

**Total Impact:**
- ~40 noisy log statements removed
- ~15 debug log statements gated behind `SF_DEVTOOLS=1`
- From **30+ log lines per transcription** → **1 wide event per transcription**

---

## Bugs Found & Fixed

### 🐛 Bug: setReady() Logic Moved Inside devConsoleLogs Gate
**What happened:** During cleanup of audio settings logs, accidentally moved `setReady(true)` and `return true` inside the `if (window.devFlags?.devConsoleLogs)` gate, breaking microphone initialization when debug logs were off.

**Fix:** Moved `setReady()` and `return` back outside the conditional gate so they always execute.

**File:** `src/hooks/useTranscription.ts` lines 1097-1121

---

## Key Learnings & Decisions

1. **Wide Events vs Scattered Logs**  
   The codebase had the RIGHT pattern (`ClientSessionEventBuilder` in `clientSessionLogger.ts`) but wasn't using it. The old `[SF] E2E` log is a proto-wide-event that we're keeping for now.

2. **devConsoleLogs Flag Strategy**  
   - Most VAD/selection logs were already gated behind `window.devFlags?.devConsoleLogs`
   - The problem was ungated logs in quota/state/startup code
   - `SF_DEVTOOLS=1` is set in all dev scripts (`dev:prod`, `dev`, etc.) which makes those gated logs visible during development

3. **What to Keep vs Remove**  
   - **Remove:** Logs that provide zero debugging value (state transitions visible in UI, cache updates, startup noise)
   - **Gate:** Logs useful for specific debugging (VAD events, audio settings, selection snapshots)
   - **Keep:** The wide event (`[SF] E2E`), error logs (`console.error/warn`), and OCR logs (useful timing info)

4. **Second-Degree Dependencies**  
   User was right to worry - some logs looked ungated but were actually behind `devConsoleLogs`. The real noise was from:
   - Quota cache (not gated)
   - State machine transitions (not gated)
   - Startup hydration (not gated)
   - WebSocket auth handshake (not gated)

---

## Context for Future Sessions

### Current State
- Console is now clean with 1-2 logs per transcription
- The `[SF] E2E` wide event is the canonical log line and should be preserved
- `ClientSessionEventBuilder` in `src/utils/clientSessionLogger.ts` exists but isn't integrated yet

### Next Steps (Not Done)
1. **Migrate [SF] E2E to ClientSessionEventBuilder** - Replace the manual wide event construction with the builder pattern from `clientSessionLogger.ts`
2. **Turn off SF_DEVTOOLS by default** - Remove `SF_DEVTOOLS=1` from `package.json` dev scripts to have clean logs by default
3. **Add OCR timing to wide event** - OCR screenshot timing is currently separate, should be part of the session event

### Files to Watch
- `src/hooks/useTranscription.ts` - Main transcription hook, contains the wide event at line ~1887
- `src/utils/clientSessionLogger.ts` - Wide event builder (exists but unused)
- `src/state/quotaCache.ts` - Now clean, no logs
- `src/components/App.tsx` - Now clean, no reducer spam

### Related Documents
- `agent-logs/2025-12-22_2227_client-wide-events.md` - Previous session that created `ClientSessionEventBuilder`
- `https://loggingsucks.com/` - Philosophy that guided this cleanup

---

## Code Changes Summary

**Modified Files:**
- `src/main.ts` - Removed display/bounds logging (7 locations)
- `src/components/App.tsx` - Removed reducer logging + notch width spam + dead ref
- `src/components/Pill.tsx` - Removed state logging
- `src/hooks/useTranscription.ts` - Removed/gated 15+ logs, fixed setReady bug
- `src/state/quotaCache.ts` - Removed all 6 console logs
- `src/state/userIdentity.ts` - Removed 3 console logs
- `src/state/transcriptionHistory.ts` - Removed loaded count log
- `src/utils/micDevices.ts` - Removed all 4 console logs

**Result:**
- Before: 30+ log lines per transcription
- After: 1-2 wide events per transcription
- All debug logs now properly gated behind `SF_DEVTOOLS=1`
