# Logging Cleanup - Phase 2: Remove Noisy Logs

**Date:** 2025-12-22  
**Branch:** `logging-sucks`  
**Status:** 🚧 In Progress

---

## What We're Cleaning

Based on actual console output, these logs are creating massive noise:

### 🔴 **CRITICAL NOISE** (Remove completely)
1. ✅ `[VAD] speech_start/end` - fires multiple times per second
2. ✅ `[QuotaCache] Cache updated/Incremented` - fires every transcription  
3. ✅ `[Reducer] Dispatching` - fires 6+ times per session
4. ✅ `[Pill] State:` - fires on every state change
5. ✅ `[SF] Auth message sent/successful` - debug noise
6. ✅ `[SF] ✅ Using pre-connected WebSocket` - debug noise
7. ✅ `[SF] Transcribe processing started` - redundant (in wide event)
8. ✅ `[SF] LLM post-process started` - redundant (in wide event)
9. ✅ `[useTranscription] Selection snapshot` - debug noise
10. ✅ `[useTranscription] Audio track settings/capabilities` - debug noise

### 🟡 **MODERATE NOISE** (Gate behind devFlags)
1. `[SF] WS endpoint` - only needed for debugging
2. `[SF] STT prompt` - only needed for debugging  
3. `[SF] AudioContext (PCM capture)` - only needed for debugging
4. `[useTranscription] Found audio input devices` - only needed for debugging
5. `[QuotaCache] Hydrated from cache` - startup noise
6. `[UserIdentity] Hydrated from cache` - startup noise

### ✅ **KEEP** (Wide Event - The Good Stuff)
- `[SF] E2E` - This is our wide event! Keep it for now until we migrate to `ClientSessionEventBuilder`

---

## Files Modified

1. `src/hooks/useTranscription.ts` - Remove/gate noisy logs
2. `src/state/quotaCache.ts` - Remove quota spam
3. `src/components/App.tsx` - Remove reducer spam
4. `src/components/Pill.tsx` - Remove state spam

---

## Next Steps

After this cleanup, we'll have:
- **ONE** log line per transcription: `[SF] E2E {...}`
- Minimal startup logs
- All debug logs gated behind `devFlags.devConsoleLogs`

Then we can migrate the `[SF] E2E` log to use `ClientSessionEventBuilder` from `clientSessionLogger.ts`.
