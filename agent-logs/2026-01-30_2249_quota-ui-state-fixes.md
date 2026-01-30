# Quota System & UI State Fixes Post HTTP Migration

**Date:** 2026-01-30
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention

User discovered two issues after the WebSocket to HTTP migration (from `2026-01-28_1200_websocket-to-http-migration.md`):
1. **Quota not updating locally** - Server-side quota increments were working (database writes), but local cache wasn't syncing, so the progress bar in the UI showed stale data
2. **UI state flash on startup** - Pro users saw an ugly "Open Onboarding to Sign In" button for ~1 second on first app load instead of their account section, creating a jarring experience

The user wanted both issues fixed, with emphasis on completely removing the ugly onboarding button and ensuring smooth, instant UI rendering on startup using cached data.

## What We Accomplished

### Quota System Fix
- ✅ **Restored wordCount flow from worker to client** - Added `wordCount` field to HTTP response payload (both bypass and LLM paths)
- ✅ **Local cache sync on each transcription** - App now receives `wordCount` from `/transcribe` and calls `incrementQuotaLocal()` for instant UI updates
- ✅ **Additional sync point from /prepare** - Added quota sync from `/prepare` response for early validation on each dictation start
- ✅ **Three-tier sync architecture** - JWT on startup, `/prepare` on dictation start, `/transcribe` on completion

### UI State Fix
- ✅ **Eliminated UI flash for Pro users** - Initialize state with cached values from `getUserIdentity()` and `getQuota()` instead of `null`
- ✅ **Deleted ugly "Open Onboarding to Sign In" button** - Completely removed the full-width button that appeared on signed-out state
- ✅ **Clean inline Sign In UI** - Replaced with account-section-style layout (icon + "Not signed in" text + "Sign In" button) for smooth transitions
- ✅ **Instant rendering on startup** - Cache hydration ensures account section and quota bar appear immediately without flashing

## Technical Implementation

### Quota System Architecture (Server-Authoritative)

**Flow:**
```
User dictates → Worker counts words from STT output (finalText) →
Worker increments database (fire-and-forget) →
Worker returns wordCount in response →
App calls incrementQuotaLocal(wordCount) → UI updates instantly →
On app startup: JWT → updateQuotaFromServer() (validation)
On dictation start: /prepare quotaInfo → updateQuotaFromServer() (validation)
```

**Three Sync Points:**
1. **Startup**: JWT claims (`words_used_this_week`) → `updateQuotaFromServer()` (App.tsx:565)
2. **Dictation start**: `/prepare` response `quotaInfo` → `updateQuotaFromServer()` (useTranscription.ts:210)
3. **Transcription complete**: `/transcribe` response `wordCount` → `incrementQuotaLocal()` (useTranscription.ts:336)

**Key Pattern:**
- Server writes (untamperable, authoritative)
- Client receives and displays (instant UI feedback)
- Multiple validation points (JWT, /prepare, /transcribe)

### UI State Initialization Pattern

**Cache Hydration Strategy:**
```typescript
// BEFORE: Started with null, waited for async fetch
const [userEmail, setUserEmail] = useState<string | null>(null);

// AFTER: Start with cached value (instant display)
const cachedIdentity = getUserIdentity(); // Reads from localStorage synchronously
const [userEmail, setUserEmail] = useState<string | null>(cachedIdentity.email);
```

Both `userIdentity.ts` and `quotaCache.ts` hydrate their caches from localStorage on module load (lines 20-35 in each file), so `getUserIdentity()` and `getQuota()` return cached values synchronously before any async fetches complete.

**Files Modified:**

**Worker (Backend):**
- `worker/src/handlers/http.ts` - Added `wordCount` to response payload (lines 292, 367, 491), added quota increment for streaming case

**Client (Frontend):**
- `src/hooks/useTranscription.ts` - Receive `wordCount` and call `incrementQuotaLocal()` (lines 334-341), sync quota from `/prepare` (lines 208-222)
- `src/components/SettingsPanel.tsx` - Initialize state with cached values (lines 162-171), replaced ugly button with clean inline Sign In UI (lines 824-849)

## Bugs & Issues Encountered

1. **Quota not syncing locally after HTTP migration**
   - **Symptom:** Database showed correct quota (worker increments working), but UI progress bar was stale
   - **Root Cause:** During WebSocket→HTTP migration, `wordCount` field wasn't added to HTTP response, so app never received it
   - **Fix:** Added `wordCount` to all response paths in `http.ts` (bypass, LLM, streaming), app now reads and calls `incrementQuotaLocal()`

2. **Streaming case didn't increment quota at all**
   - **Symptom:** SSE streaming responses (for LLM enhancement) didn't track quota
   - **Root Cause:** Streaming path (lines 301-384) never called `scheduleQuotaIncrement()` or included `wordCount` in events
   - **Fix:** Added word counting and quota increment in streaming path (note: streaming is disabled by default, `LLM_DEFAULT_STREAM = false`)

3. **UI flash on Pro account startup**
   - **Symptom:** Pro users saw "Open Onboarding to Sign In" button for ~1 second before account section appeared
   - **Root Cause:** State initialized with `null` instead of cached values, brief delay before `initUserIdentity()` promise resolved
   - **Fix:** Initialize `useState` with `getUserIdentity()` and `getQuota()` which read from localStorage synchronously

## Key Learnings

- **localStorage cache hydration is synchronous**: Both `userIdentity.ts` and `quotaCache.ts` hydrate their caches on module load (top-level try/catch blocks). This means `getUserIdentity()` and `getQuota()` return cached values immediately, even before React mounts.

- **Initialize state with cache, not null**: For any state that has a localStorage cache, initialize `useState(cachedValue)` instead of `useState(null)` to prevent UI flashing. The subscription will still update it when fresh data arrives.

- **HTTP migration broke local sync flow**: When migrating from WebSocket (which sent `wordCount` in final message) to HTTP (JSON response), the `wordCount` field wasn't included in the new response format. Always check that all fields from old protocol are preserved in new one.

- **Quota counts STT output, not LLM output**: This was already correct in the migration, but worth noting - `finalText` (transcription) is counted, not `enhanceResult.text` (LLM generation). Fair pricing for edit mode.

- **Three sync points prevent drift**: JWT on startup validates cache, `/prepare` validates before each dictation, `/transcribe` updates after each completion. This ensures local cache never drifts far from server truth.

## Architecture Decisions

- **Why initialize with cache instead of null:**
  - **Pro:** Instant UI rendering, no flash of wrong state, smoother UX
  - **Con:** Could show stale data if cache is old
  - **Acceptable:** Subscriptions update with fresh data within milliseconds anyway, and cache is refreshed on every app restart via JWT

- **Why sync quota from both /prepare and /transcribe:**
  - **Pro:** Multiple validation points prevent drift, catches edge cases where JWT is stale
  - **Con:** Slightly redundant network overhead
  - **Acceptable:** `/prepare` already runs for OCR, adding quota to response is free

- **Why delete "Open Onboarding to Sign In" button instead of fixing flash:**
  - **User requirement:** "yank the fuck out" - clear preference to delete it
  - **UX:** Full-width primary button is too aggressive for signed-out state
  - **Better:** Inline secondary button matches account section layout (less jarring)

- **Why keep streaming quota fix even though streaming is disabled:**
  - **Pro:** Code is complete and correct if streaming is ever re-enabled
  - **Con:** Dead code path (all `*_DEFAULT_STREAM = false`)
  - **Acceptable:** Small fix (~10 lines), maintains code quality, prevents future bugs

## Ready for Next Session

- ✅ **Quota system fully operational** - Server writes, client syncs, three validation points (JWT, /prepare, /transcribe)
- ✅ **UI state rendering instant** - No flashing on startup for any account type (Pro, Free, or signed-out)
- ✅ **Clean signed-out UI** - Inline layout matches account section style, no jarring transitions
- ✅ **All HTTP paths handle quota** - Bypass, LLM, and streaming (even though streaming disabled by default)
- 🔧 **Monitor quota accuracy in production** - Watch for edge cases where local cache might drift from server

## Context for Future

This session completed the HTTP migration cleanup by restoring the quota sync flow that was accidentally broken during the WebSocket→HTTP migration. The quota system is now production-ready with server-authoritative writes and three client-side sync points for validation.

The UI state fix demonstrates a general pattern for this codebase: **always initialize React state with cached values from localStorage-backed modules** (`userIdentity.ts`, `quotaCache.ts`, etc.) to prevent UI flashing. These modules hydrate synchronously on load, so cached data is always available immediately.

**Related logs:**
- `2026-01-28_1200_websocket-to-http-migration.md` - HTTP migration that introduced the quota sync bug
- `2025-12-22_1430_quota-1k-weekly.md` - Weekly quota system (1000 words/week)
- `2025-12-04_1330_free-tier-quota-implementation.md` - Original server-authoritative quota architecture
