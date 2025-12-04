# Fix Free Tier Quota System

**Date:** 2025-12-04  
**Agent:** Claude Sonnet 4  
**Status:** ✅ Completed

## User Intention

The user needed to fix the free tier quota system (2000 words/month). Two interconnected issues needed resolution:

1. **Quota Sync Bug:** The quota was not syncing correctly from database → JWT → Worker/Client. Workers saw `wordsUsed: 0` even when database showed 2735 words.
2. **Notification Bug:** When quota was exhausted, no notification appeared to the user. When they tried to dictate, frequency bars would freeze instead of showing a proper error.

## Part 1: Database Hook Fix

### The Debugging Journey

We faced a confusing situation where the database had correct values, but Worker and Client were out of sync:

- **Database**: 2735 words (correct)
- **Worker logs**: `wordsUsed: 0` (from JWT claims)  
- **Client cache**: 1182 words (stale localStorage)

**The Breakthrough:**  
By manually executing the hook in SQL Editor (`SELECT public.custom_access_token_hook(...)`), we discovered:
```
ERROR: 0A000: UPDATE is not allowed in a non-volatile function
```

The function was defined as `STABLE` (promising no side effects), but contained an `UPDATE` for the "lazy monthly reset" logic. Postgres blocked the write silently.

### The Fix

- ✅ Changed function from `STABLE` to `VOLATILE` (allowing writes)
- ✅ Added `SECURITY DEFINER` (bypassing RLS to read/write profiles)
- ✅ Added client-side sync to decode JWT on startup and update local cache

## Part 2: Notification & Gating Fix

### Issues Discovered

After the hook was fixed, quota enforcement worked but notifications didn't:

1. **Notification only showed once:** The `useEffect` only fires when `trans.authError` *changes*. If already set, retrying didn't trigger it.
2. **Frequency bars froze:** When PTT was pressed, pill transitioned to LISTENING immediately. If quota check failed, `start()` returned early without resetting the state.
3. **Error not recognized:** The catch block didn't recognize "Quota exceeded" as an auth error.

### The Fix

**1. Clear auth error at start of each attempt:**
```typescript
setAuthError(null); // Ensures re-setting it triggers the useEffect
```

**2. Send notification directly + update patterns:**
```typescript
window.notifications?.send?.(errorMsg);
```

**3. Added "Quota" to error recognition in catch block:**
```typescript
if (errorMessage.includes("Quota")) { ... }
```

**4. Added local quota gating for instant feedback:**
```typescript
const { isQuotaExceeded } = await import('../state/quotaCache');
if (isQuotaExceeded()) {
  setAuthError("payment_required");
  setError("You've used your free words this month. Upgrade for unlimited.");
  window.notifications?.send?.(errorMsg);
  return;
}
```

**5. Added error patterns to pill reducer:**
```typescript
event.msg.includes("expired") ||
event.msg.includes("Upgrade") ||
event.msg.includes("Sign in") ||
event.msg.includes("free words") ||
```

### Improved Copywriting

| Scenario | Old Message | New Message |
|----------|-------------|-------------|
| Not signed in | "Subscription required. Upgrade to continue." | "Sign in to start dictating." |
| Session expired | "Subscription required. Upgrade to continue." | "Session expired. Please sign in again." |
| Payment required | "Subscription required. Upgrade to continue." | "Upgrade to Pro for unlimited dictation." |
| Quota exceeded | "Monthly word limit reached. Upgrade for unlimited dictation." | "You've used your free words this month. Upgrade for unlimited." |

## Files Modified

**Database:**
- `public.custom_access_token_hook` - Changed to `VOLATILE`, added `SECURITY DEFINER`

**App:**
- `src/components/App.tsx` - JWT decoding on startup, error patterns in pill reducer
- `src/hooks/useTranscription.ts` - Local quota gating, `setAuthError(null)`, direct notification, error recognition

**Worker:**
- `worker/src/handlers/ws.ts` - Updated quota exceeded error message

## How It Works Now

**Two-Level Gating:**
1. **Local (Instant):** `isQuotaExceeded()` checks localStorage immediately
2. **Server (Authoritative):** Worker checks JWT claims

**Notification Flow:**
1. User presses PTT → `pillDispatch({ type: "PTT_START" })` → LISTENING state
2. `start()` is called → `setAuthError(null)` clears previous error
3. Local quota check (instant)
4. If exceeded → `setAuthError` + `setError` + `window.notifications.send()`
5. Pill reducer receives NOTIFY → transitions LISTENING → NOTIFICATION (no frozen bars)

## Key Learnings

- **Postgres Function Volatility:** `STABLE` functions cannot write. Auth hooks with writes must be `VOLATILE`.
- **useEffect only fires on change:** Must clear first, then set to re-trigger.
- **Direct notification is reliable:** Using `window.notifications.send()` ensures notification shows regardless of React re-render timing.
- **Pill reducer needs all patterns:** New error messages must be added to `isErrorNotif` check.

## Testing

1. Set `localStorage.setItem('sf.quotaWordsUsed', '2000')`
2. Try to dictate → Notification appears, no frozen bars
3. Try again → Notification appears every time
4. Restart app → Same behavior after JWT refresh
