# Fix Quota Notification & Local Gating

**Date:** 2025-12-04  
**Agent:** Claude Sonnet 4  
**Status:** ✅ Completed

## User Intention
The user reported that when the JWT refreshes and detects that the quota is exceeded, no notification was showing up. They wanted:
1. The notification to appear when the user tries to dictate after quota exhaustion
2. Local gating so that when the user hits 2000 words locally, they're immediately blocked without waiting for server round-trip
3. Improved copywriting for all gating-related error messages
4. **Update**: Notification should show EVERY time the user tries to dictate, not just once
5. **Update**: The frequency bars shouldn't freeze when quota is exceeded

## What We Accomplished

### Fix 1: Quota Exceeded Error Recognition
The catch block in `start()` wasn't recognizing "Quota exceeded" as an auth error, causing the proper error message to be overwritten.

**Before:**
```typescript
if (errorMessage.includes("Not signed in") || errorMessage.includes("Auth") || errorMessage.includes("Payment")) {
```

**After:**
```typescript
if (
  errorMessage.includes("Not signed in") ||
  errorMessage.includes("Auth") ||
  errorMessage.includes("Payment") ||
  errorMessage.includes("Quota")
) {
```

### Fix 2: Local Quota Gating
Added instant local quota check at the start of `start()` function. This provides immediate feedback without waiting for server round-trip.

### Fix 3: Notification Shows EVERY Time
The original issue was that the `useEffect` in App.tsx only fires when `trans.authError` changes. If it's already set, trying to dictate again doesn't trigger a notification.

**Solution:** Clear `authError` at the start of each dictation attempt:
```typescript
// Clear previous auth error so re-setting it triggers the useEffect in App.tsx
setAuthError(null);
```

And also send the notification directly via `window.notifications.send()`:
```typescript
// Send notification directly for immediate feedback
try {
  window.notifications?.send?.(errorMsg);
} catch { }
```

### Fix 4: Prevent Frequency Bar Freeze
Added more patterns to the error notification detection in the pill reducer. When an error notification arrives while in LISTENING state, the pill immediately transitions to NOTIFICATION (skipping the frozen bars).

**Added patterns:**
```typescript
event.msg.includes("expired") ||
event.msg.includes("Upgrade") ||
event.msg.includes("Sign in") ||
event.msg.includes("free words") ||
```

### Fix 5: Improved Copywriting
Updated all gating-related error messages to be more user-friendly:

| Scenario | Old Message | New Message |
|----------|-------------|-------------|
| Not signed in | "Subscription required. Upgrade to continue." | "Sign in to start dictating." |
| Session expired | "Subscription required. Upgrade to continue." | "Session expired. Please sign in again." |
| Payment required | "Subscription required. Upgrade to continue." | "Upgrade to Pro for unlimited dictation." |
| Quota exceeded | "Monthly word limit reached. Upgrade for unlimited dictation." | "You've used your free words this month. Upgrade for unlimited." |
| Worker quota msg | "Monthly word limit exceeded" | "Free words used up this month" |

## Files Modified

**App (src/hooks/useTranscription.ts):**
- Added "Quota" to auth error recognition in catch block
- Added local quota gating at start of `start()` function
- Added `setAuthError(null)` to clear previous errors
- Added direct notification via `window.notifications.send()`
- Updated error messages for all auth scenarios

**App (src/components/App.tsx):**
- Added more error patterns to pill reducer for immediate transition from LISTENING to NOTIFICATION

**Worker (worker/src/handlers/ws.ts):**
- Updated quota exceeded error message to friendlier copy

## How It Works Now

**Two-Level Gating:**
1. **Local (Instant):** `isQuotaExceeded()` checks the localStorage cache immediately. If the user has used 2000+ words locally, they're blocked instantly with a notification.
2. **Server (Authoritative):** The worker still checks JWT claims. This is the source of truth and catches cases where local cache might be stale or tampered.

**Notification Flow:**
1. User presses PTT → `start()` is called
2. `setAuthError(null)` clears previous error (ensures useEffect will fire)
3. Local quota check runs (instant)
4. If local check fails → `setAuthError` + `setError` + `window.notifications.send()` → notification shows
5. Pill reducer receives NOTIFY event → transitions from LISTENING → NOTIFICATION (no frozen bars)
6. If local check passes → Connect to WebSocket → JWT auth
7. If JWT quota check fails → Worker sends close code 4021 → Client catches it → same notification flow

## Key Learnings

- **useEffect only fires on change:** Setting the same value doesn't trigger it. Must clear first, then set.
- **Direct notification + state change:** Using both `window.notifications.send()` AND `setAuthError/setError` ensures notification shows regardless of race conditions.
- **Pill reducer needs all error patterns:** Any new error message format must be added to the `isErrorNotif` check to prevent UI freeze.

## Ready for Testing

1. Use up 2000 words (or manually set `localStorage.setItem('sf.quotaWordsUsed', '2000')`)
2. Try to dictate → Should see notification immediately, no frozen frequency bars
3. Try to dictate again → Should see notification again (not just once)
4. After JWT refresh (restart app) → Should see notification every time you try to dictate
