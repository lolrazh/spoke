# Error Handling & User Identity Caching

**Date:** 2025-10-08  
**Agent:** Claude 3.5 Sonnet  
**Status:** ✅ Completed  

## User Intention
User wanted better error handling with pill-friendly notification messages instead of technical errors like "WebSocket connection failed" or "GROQ connection failed". Additionally, they wanted to cache user name and email locally so the Settings panel shows user info immediately even when offline, preventing blank fields when there's no internet connection.

## What We Accomplished
- ✅ **Structured Error System** - Created ErrorCode enum (1xxx-9xxx) with categorized error codes and short, actionable messages
- ✅ **Error Handler Utilities** - Built comprehensive error parsing for network, WebSocket, media permissions, and server errors
- ✅ **Backend Error Codes** - Updated worker WebSocket handler to send structured error responses with codes and retry hints
- ✅ **Frontend Error Integration** - Integrated structured errors throughout useTranscription.ts with network detection
- ✅ **User Identity Cache** - Implemented localStorage caching for name + email with automatic sync on sign-in/sign-out
- ✅ **Centralized User State** - Refactored SettingsPanel to use centralized userIdentity subscription (removed duplicate logic)

## Technical Implementation

### Error Handling Architecture
Created a layered error system optimized for pill notifications:

**Error Categories:**
- Network (1xxx): Offline, timeout, connection failures
- Auth (2xxx): Sign-in required, session expired
- Permissions (3xxx): Mic, accessibility, input monitoring
- Transcription (4xxx): STT API errors, timeouts, audio issues
- LLM (5xxx): Post-processing failures
- System (9xxx): Buffer overflow, unknown errors

**Error Flow:**
1. Error occurs (network fail, mic denied, buffer overflow)
2. Detected by handler (WebSocket, getUserMedia, etc.)
3. Mapped to ErrorCode via utility functions
4. User message extracted from ERROR_MESSAGES
5. Displayed in pill via window.notifications.send()

**Key Design Decisions:**
- **Short messages only** - All messages ~30-50 chars to fit pill width constraints
- **Actionable copy** - "Microphone access needed" instead of "NotAllowedError"
- **No title/body split** - Single-line notifications only (unlike typical toast systems)
- **Network detection** - Monitors `navigator.onLine` for offline state
- **Structured responses** - Backend sends `{ type: "error", code: 4001, retryable: false }`

### User Identity Caching Architecture
Implemented centralized cache with automatic sync:

**Cache Strategy:**
- Hydrate from localStorage on app startup (instant UI)
- Subscribe to Supabase auth changes (auto-sync on sign-in)
- Clear cache on sign-out (integrated in supabaseClient)
- Notify all subscribers on any identity change

**Cache Keys:**
- `sf.userName` - User's display name
- `sf.userEmail` - User's email address
- Legacy `sf.lastUserEmail` removed in cleanup

**Flow:**
1. **App Start** → Cache loads instantly → Shows name/email immediately
2. **Background** → Fetches fresh data from Supabase → Updates cache if changed
3. **Sign In** → `onAuthStateChange` fires → Cache updates → UI updates
4. **Sign Out** → `clearUserIdentityCache()` called → Cache cleared → Subscribers notified

**Files Modified:**

**Error Handling:**
- `src/types/errors.ts` - NEW: ErrorCode enum, ERROR_MESSAGES, AppError interface
- `src/utils/errorHandler.ts` - NEW: Error parsing utilities (parseServerError, parseMediaError, parseWebSocketError, etc.)
- `worker/src/handlers/ws.ts` - Added structured error codes to all error responses
- `src/hooks/useTranscription.ts` - Integrated structured errors, added network monitoring

**User Identity Caching:**
- `src/state/userIdentity.ts` - Added name caching, cache hydration, clearUserIdentityCache()
- `src/lib/supabaseClient.ts` - Auto-clear cache on signOut()
- `src/components/SettingsPanel.tsx` - Refactored to use centralized userIdentity subscription

## Bugs & Issues Encountered
1. **Initial approach used title + message format**
   - User pointed out pill notifications are single-line only
   - **Fix:** Changed to single short message string (~30-50 chars max)

2. **SettingsPanel had duplicate localStorage logic**
   - Redundant cache management scattered across components
   - **Fix:** Centralized all caching in userIdentity.ts, removed duplicates

3. **Tests showed pre-existing failures**
   - 3 pre-existing test failures in useTranscription.test.tsx
   - **Status:** Unrelated to our changes, no new regressions introduced

## Key Learnings
- **Pill width constraints require careful copy** - Every notification message must fit in ~30-50 chars
- **Network detection is fragile** - `navigator.onLine` isn't always accurate, but good enough for UX hints
- **Cache hydration prevents flicker** - Loading from localStorage first, then fetching DB creates instant UI
- **Centralized state beats scattered logic** - Moving all identity caching to one place eliminated bugs and duplicate code
- **Error codes enable better analytics** - Structured codes (vs strings) allow tracking error trends in Sentry
- **Circuit breaker for reconnects** - Max 10 reconnect attempts before entering 1-minute cooldown prevents infinite retry loops

## Architecture Decisions
- **Error codes over HTTP status codes** - Used semantic error codes (1xxx-9xxx) instead of HTTP status for clearer categorization
- **Network monitor in useTranscription** - Added `online`/`offline` event listeners directly in hook (avoids extra context)
- **Auto-cache sync on auth change** - Used `onAuthStateChange` subscription to automatically update cache (no manual sync needed)
- **Supabase integration for cache clear** - Integrated `clearUserIdentityCache()` into `signOut()` function (automatic cleanup)
- **Trade-off: Console logs added** - Added `[UserIdentity]` and `[Error]` console logs for debugging (can be stripped in production)

## Ready for Next Session
- ✅ **Error system fully integrated** - All major error scenarios have user-friendly messages
- ✅ **Cache works offline** - User name/email persist across restarts and offline scenarios
- ✅ **Network detection active** - Auto-detects offline state and reconnects when online
- 🔧 **Error messages can be refined** - Current messages are good but can be improved based on user feedback
- 🔧 **Localization ready** - ERROR_MESSAGES object is perfect for future i18n support

## Context for Future
This session established two critical foundations:

1. **Structured error handling** - All future features can now use the error code system for consistent, user-friendly error messages. The pill notification system is fully understood and optimized for short, actionable copy.

2. **Centralized user identity cache** - Any component can now access cached user info instantly via `subscribeUserIdentity()`. This pattern can be extended to cache other user preferences (theme, language, etc.) for instant offline-first UX.

Both systems are production-ready and form the basis for better user experience: clear error feedback and instant-loading UI even when offline. The architecture supports easy extension (new error codes, additional cached fields) without breaking existing functionality.
