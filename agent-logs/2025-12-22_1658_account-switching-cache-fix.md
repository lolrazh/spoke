# Account Switching Cache Synchronization Fix

**Date:** 2025-12-22
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention

User experienced a critical bug where switching between accounts (signing out from Account A and signing in with Account B) displayed stale cached data in the Settings Panel. The bug had two symptoms: (1) Account B showed Account A's name and email, and (2) Account B showed Account A's subscription tier (Pro vs Free). While quota/tier was partially addressed in previous attempts (2025-12-20), the identity cache bug persisted through 4 failed fix attempts. The underlying goal was to ensure complete cache isolation between user accounts—when switching accounts, all cached data (identity, quota, tier) should immediately reflect the new account without requiring an app restart.

## What We Accomplished

- ✅ **Identity Cache Fix** - Resolved stale promise caching bug that caused Account A's name/email to persist after switching to Account B
- ✅ **Quota/Tier Sync on Sign-In** - Implemented JWT decoding in SIGNED_IN handler to sync subscription status and quota immediately when signing in
- ✅ **Quota Cache Clearing on Sign-Out** - Added quota cache clearing to both auth listener and polling-detected sign-out handlers
- ✅ **Comprehensive Diagnostic Logging** - Instrumented userIdentity.ts, SettingsPanel.tsx, and supabaseClient.ts to identify root cause through console logs
- ✅ **Root Cause Identification** - Discovered `initPromise` was cached and never cleared, returning stale data on subsequent calls

## Technical Implementation

### Identity Cache Fix (userIdentity.ts)

**Root Cause:** The `initUserIdentity()` function caches its promise in `initPromise` to prevent duplicate initialization. However, `initPromise` was never cleared on sign-out, causing `SettingsPanel` to receive stale Account A data when Account B signed in.

**The Bug:**
```typescript
let initPromise: Promise<UserIdentity> | null = null;

export async function initUserIdentity(): Promise<UserIdentity> {
  if (initPromise) return initPromise;  // ← Returns cached promise from Account A!
  initPromise = (async () => {
    await refreshIdentity();
    await subscribeToAuthChanges();
    initialized = true;
    return identity;  // ← This identity was Account A's data
  })();
  return initPromise;
}
```

**Symptoms:**
- Subscription (via `subscribeUserIdentity()`) received correct Account B data ✅
- Promise (via `initUserIdentity()`) returned stale Account A data ❌
- SettingsPanel showed Account A's email in the resolved promise while subscription showed Account B's email

**The Fix:**
```typescript
export function clearUserIdentityCache() {
  // ... existing clearing logic ...

  // 🔥 CRITICAL: Clear cached promise to force re-initialization
  initPromise = null;

  // ... notify listeners ...
}
```

**File:** `src/state/userIdentity.ts:239`

---

### Quota/Tier Sync on Sign-In (App.tsx)

**Root Cause:** Quota and subscription tier were only synced from JWT claims on **app startup**, not when a user signed in during an active session. This meant switching accounts showed stale tier data until the app was restarted.

**The Fix:**
```typescript
// In App.tsx SIGNED_IN handler
setTimeout(async () => {
  try {
    if (session?.access_token) {
      // Decode JWT payload to get custom claims
      const payloadBase64 = session.access_token.split('.')[1];
      const payloadJson = atob(payloadBase64);
      const payload = JSON.parse(payloadJson);

      // Extract subscription status (Pro vs Free)
      const isPro = payload.subscription_active === true;

      // Update local cache with quota and subscription status
      const { updateQuotaFromServer } = await import('../state/quotaCache');
      updateQuotaFromServer({
        wordsUsed: payload.words_used_this_week || 0,
        resetDate: payload.quota_reset_date || null,
        isPro,
      });
    }
  } catch (e) {
    console.warn('[App] Failed to sync quota from JWT on sign-in:', e);
  }
}, 0);
```

**File:** `src/components/App.tsx:652-683`

---

### Quota Cache Clearing on Sign-Out (App.tsx)

**Root Cause:** While `clearUserIdentityCache()` was called on sign-out, `clearQuotaCache()` was NOT, causing stale tier/quota data to persist across account switches.

**The Fix:** Added quota cache clearing to both sign-out code paths:

1. **Auth listener sign-out handler:**
```typescript
setTimeout(() => {
  (async () => {
    try {
      latestTransRef.current?.cancel?.();
    } catch { }

    // 🔥 Clear quota cache on sign-out
    try {
      const { clearQuotaCache } = await import('../state/quotaCache');
      clearQuotaCache();
    } catch (e) {
      console.warn('[App] Failed to clear quota cache on sign-out:', e);
    }
    // ... rest of sign-out logic
  })();
}, 0);
```

2. **Polling-detected sign-out handler:**
```typescript
if (!error && !data?.user) {
  // ... existing guards ...

  // 🔥 Clear quota cache on polling-detected sign-out
  try {
    const { clearQuotaCache } = await import('../state/quotaCache');
    clearQuotaCache();
  } catch (e) {
    console.warn('[App] Failed to clear quota cache on polling sign-out:', e);
  }
  // ... rest of sign-out logic
}
```

**Files:**
- `src/components/App.tsx:711-718` (auth listener sign-out)
- `src/components/App.tsx:755-762` (polling sign-out)

---

### Diagnostic Logging Added

To identify the root cause, comprehensive logging was added across the identity cache system:

**userIdentity.ts:**
- `emit()` - Logs every call with current vs next values, shows when change guard blocks
- `clearUserIdentityCache()` - Detailed before/after logging for in-memory and localStorage state
- `subscribeUserIdentity()` - Logs when subscriptions are added/removed and whether they fire immediately
- Auth state listener - Logs SIGNED_IN/SIGNED_OUT events with user IDs

**SettingsPanel.tsx:**
- Logs when subscribing to userIdentity
- Logs values received from `initUserIdentity()`
- Logs every identity update from subscription

**supabaseClient.ts:**
- Logs when `signOut()` is called and completes
- Confirms when `clearUserIdentityCache()` is called

**Key Insight from Logs:**
```javascript
// This revealed the bug:
[SettingsPanel] Received identity update: {email: 'sandy@spoke.so'}      // ✅ Subscription correct
[SettingsPanel] initUserIdentity resolved: {email: 'rajkumar.sandheep@gmail.com'}  // ❌ Promise stale
```

**Files Modified:**
- `src/state/userIdentity.ts` - Added diagnostic logging and `initPromise` clearing
- `src/components/App.tsx` - Added quota sync on sign-in and quota clearing on sign-out
- `src/components/SettingsPanel.tsx` - Added diagnostic logging
- `src/lib/supabaseClient.ts` - Added diagnostic logging

## Bugs & Issues Encountered

### 1. **Stale Promise Cache (CRITICAL - FIXED)**
**Symptoms:** After switching from Account A to Account B, SettingsPanel showed Account A's email/name even though subscription data was correct.

**Root Cause:** `initUserIdentity()` cached its promise in `initPromise` and never cleared it. When SettingsPanel called `initUserIdentity()` after Account B signed in, it received the old cached promise from Account A's initialization.

**Fix:** Clear `initPromise = null` in `clearUserIdentityCache()` to force re-initialization on next call.

**Diagnosis Method:** Added comprehensive logging showing subscription received correct data while promise returned stale data—this pointed directly to promise caching.

---

### 2. **Quota Not Synced on Sign-In (FIXED)**
**Symptoms:** Switching from free account to pro account showed free tier status until app restart.

**Root Cause:** Quota/tier sync only happened on app startup (lines 531-568 in App.tsx), not in the SIGNED_IN event handler.

**Fix:** Decode JWT and call `updateQuotaFromServer()` in the SIGNED_IN handler (deferred with `setTimeout` to avoid breaking auth listener).

---

### 3. **Quota Cache Not Cleared on Sign-Out (FIXED)**
**Symptoms:** Stale tier/quota data persisted after signing out.

**Root Cause:** `clearQuotaCache()` was never called during sign-out flow, only `clearUserIdentityCache()` was called.

**Fix:** Added `clearQuotaCache()` calls to both auth listener sign-out and polling-detected sign-out handlers.

---

### 4. **Four Previous Failed Fix Attempts (2025-12-20 to 2025-12-22)**

**Previous attempts to fix identity cache:**

1. **Fix #1: Clear identity cache from App.tsx** - Failed due to race condition between App.tsx and userIdentity.ts auth listeners fighting over the same state

2. **Fix #2: User ID tracking in userIdentity.ts** - Failed (reason unknown, reverted before thorough testing)

3. **Fix #3: Unified UserSession module** - Created new `userSession.ts` combining identity + quota into single state with one auth listener. Failed after testing—likely due to initialization timing issues where SettingsPanel subscribed before auth events fired.

4. **Fix #4: Mirror quota fix pattern in userIdentity.ts** - Added `prevUserId` tracking identical to quota cache fix. Mysteriously failed despite using the exact same pattern that worked for quota.

**Why Previous Fixes Failed:**

All previous attempts focused on **when** to clear the cache (user ID changes, sign-out events, etc.) but never addressed the **cached promise** that was the actual root cause. The diagnostic logging finally revealed that the subscription worked perfectly while the promise returned stale data—pointing directly to `initPromise` caching.

**Key Lesson:** Sometimes the problem isn't about *coordination* or *timing*—it's about *cached derived state* that never gets invalidated. The promise cache was invisible to all previous debugging because we were focused on the `identity` object and localStorage, not the promise wrapper.

## Key Learnings

- **Cached Promises Are Invisible Bugs** - Promises cached in module-level variables can return stale data even when the underlying state is cleared. Always clear promise caches alongside state caches.

- **Diagnostic Logging Reveals Truth** - Without comprehensive logging showing "subscription works, promise doesn't", we would never have identified the promise cache as the culprit. Previous fix attempts failed because we didn't have visibility into the exact failure point.

- **Identical Patterns ≠ Identical Behavior** - The same clearing pattern worked for quota but failed for identity (Fix #4) because quota didn't have a cached promise wrapper. This taught us to look for architectural differences, not just timing/coordination differences.

- **JWT Decoding in Auth Handlers** - Custom JWT claims (subscription status, quota) should be synced in BOTH startup refresh AND sign-in handlers. Only syncing on startup means mid-session account switches show stale data.

- **Two Sign-Out Paths** - The app has two sign-out mechanisms: (1) auth listener detecting `!session?.user`, and (2) polling-based sign-out detection. Both paths need identical cache clearing logic.

- **Deferred Supabase Operations** - All Supabase operations inside `onAuthStateChange` callbacks must be wrapped in `setTimeout(fn, 0)` to avoid breaking the auth listener (documented Supabase behavior).

- **Module-Level Hydration Timing** - Cache hydration from localStorage happens on module load (before auth events fire). This means stale data can flash briefly in the UI unless subscriptions are guarded with `initialized` flags.

## Architecture Decisions

- **Promise Cache Invalidation** - Decided to clear `initPromise` in `clearUserIdentityCache()` rather than removing the promise cache entirely. The cache still serves its purpose (preventing duplicate initialization) but now properly invalidates on sign-out.

- **Quota Sync in Two Places** - Chose to sync quota from JWT in both app startup AND sign-in handler rather than trying to unify them. This ensures both cold start (restart app) and warm switch (account switching) scenarios work correctly.

- **Diagnostic Logging Kept** - Decided to keep the comprehensive diagnostic logging in place (at least for now) because it provides valuable debugging visibility and doesn't significantly impact performance. Future cleanup could remove these logs if desired.

- **Mirrored Clearing Logic** - Applied the same clearing pattern across both sign-out code paths (auth listener + polling) to ensure consistency. If one path is updated in the future, the other should be updated identically.

## Ready for Next Session

- ✅ **Complete Account Isolation** - All cached data (identity, quota, tier) now properly isolates between accounts with zero stale data
- ✅ **Diagnostic Infrastructure** - Comprehensive logging is in place for debugging future cache-related issues
- ✅ **JWT Sync on Sign-In** - Subscription and quota claims are now synced immediately on sign-in, enabling instant tier upgrades without restart
- 🔧 **Logging Cleanup (Optional)** - The diagnostic logging added during debugging could be removed or reduced if desired, but provides valuable visibility for future debugging

## Context for Future

This fix completes the account switching user experience—users can now freely switch between multiple accounts (Pro/Free tiers, different emails) and see correct data immediately without restarting the app. The root cause was a cached promise that previous 4 fix attempts missed because they focused on state coordination rather than derived state invalidation. This work establishes a pattern for future cache implementations: always consider cached promises/wrappers alongside the underlying state, and use comprehensive diagnostic logging to identify exactly where data flows break.

## Related Files

- `src/state/userIdentity.ts` - Identity cache module (fixed promise caching)
- `src/state/quotaCache.ts` - Quota cache module (working correctly)
- `src/components/App.tsx` - Main auth listener with quota sync
- `src/components/SettingsPanel.tsx` - Consumer of both caches
- `src/lib/supabaseClient.ts` - Sign-out function
- `docs/AUTH.md` - Authentication flow documentation
- `agent-logs/2025-12-20_2322_account-quota-cache-sync-fix.md` - Previous partial fix (DELETE - superseded by this log)
