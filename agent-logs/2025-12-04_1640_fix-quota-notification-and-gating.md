# Fix Quota Notification & Local Gating

**Date:** 2025-12-04  
**Agent:** Claude Sonnet 4  
**Status:** ✅ Completed

## User Intention
The user reported that when the JWT refreshes and detects that the quota is exceeded, no notification was showing up. They wanted:
1. The notification to appear when the user tries to dictate after quota exhaustion
2. Local gating so that when the user hits 2000 words locally, they're immediately blocked without waiting for server round-trip
3. Improved copywriting for all gating-related error messages

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

```typescript
// LOCAL QUOTA GATING: Check if the local cache shows quota exceeded
try {
  const { isQuotaExceeded } = await import('../state/quotaCache');
  if (isQuotaExceeded()) {
    console.log('[useTranscription] Local quota check: exceeded');
    setAuthError("payment_required");
    setError("You've used your free words this month. Upgrade for unlimited.");
    return;
  }
} catch {
  // Quota check failed - continue anyway, server will enforce
}
```

### Fix 3: Improved Copywriting
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
- Updated error messages for all auth scenarios

**Worker (worker/src/handlers/ws.ts):**
- Updated quota exceeded error message to friendlier copy

## How It Works Now

**Two-Level Gating:**
1. **Local (Instant):** `isQuotaExceeded()` checks the localStorage cache immediately. If the user has used 2000+ words locally, they're blocked instantly with a notification.
2. **Server (Authoritative):** The worker still checks JWT claims. This is the source of truth and catches cases where local cache might be stale or tampered.

**Notification Flow:**
1. User presses PTT → `start()` is called
2. Local quota check runs (instant)
3. If local check fails → `setAuthError` + `setError` → notification shows
4. If local check passes → Connect to WebSocket → JWT auth
5. If JWT quota check fails → Worker sends close code 4021 → Client catches it → notification shows

## Key Learnings

- **Error message matching is fragile:** The catch block was matching error messages by string content. Adding "Quota" was necessary because the rejection message was "Quota exceeded".
- **Local gating improves UX:** Even though the server is authoritative, a local check provides instant feedback (no network latency).
- **Copywriting matters:** User-friendly error messages reduce confusion and clearly communicate what action the user should take.

## Ready for Testing

1. Use up 2000 words (or manually set localStorage `sf.quotaWordsUsed` to 2000)
2. Try to dictate → Should see "You've used your free words this month. Upgrade for unlimited."
3. The notification should appear immediately (local gating) without waiting for server
