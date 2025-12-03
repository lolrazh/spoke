# Post-Payment JWT Refresh Fix

**Date:** 2025-12-03  
**Agent:** Claude Sonnet 4.5  
**Status:** ✅ Completed  

## User Intention

User discovered a critical UX issue in the payment flow: after a customer pays for a subscription on the website, they cannot immediately start dictating in the desktop app because their JWT still contains the old `subscription_active: false` claim. The user correctly identified this as a JWT refresh timing problem rather than a revocation issue. They wanted a simple solution that matches natural user behavior (restarting the app) rather than complex webhook-based approaches. The underlying goal was to ensure paying customers get instant access after payment without requiring technical workarounds like manual sign-out/sign-in.

## What We Accomplished

- ✅ **JWT Refresh on App Startup** - Added `refreshSession()` call in `App.tsx` that runs every time the app starts, ensuring users get a fresh JWT with updated subscription claims from the Custom Access Token Hook
- ✅ **Educated on JWT Architecture** - Explained how Supabase JWT refresh works, the 1-hour default expiry, and why the Custom Access Token Hook approach was chosen for the optimization (50x speedup, 99% reduction in DB queries)
- ✅ **Documented Post-Payment Flow** - Clarified the complete user journey from payment to dictation access, including the JWT claim propagation delay
- ✅ **Simple User Experience** - Solution requires only restarting the app (npm run dev:local), which is intuitive behavior when something doesn't work immediately

## Technical Implementation

### The Core Fix (App.tsx lines 493-506)

```typescript
// Refresh session on app startup to get fresh JWT with latest subscription claims
if (!skipAuth) {
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.auth.refreshSession();
      console.log('[App] Session refreshed on startup - JWT claims updated');
    } catch (error) {
      console.warn('[App] Failed to refresh session on startup:', error);
      // Continue anyway - getCurrentUser will return cached session
    }
  }
}
```

### How It Works

1. **App starts** → `useEffect` in `App.tsx` runs (line 483)
2. **Before checking user** → Calls `supabase.auth.refreshSession()`
3. **Supabase issues new JWT** → Runs Custom Access Token Hook (Postgres function)
4. **Hook queries database** → Checks `subscriptions.status = 'active'` for user
5. **Adds claim to JWT** → Sets `subscription_active: true` (or `false`) in token payload
6. **App continues** → `getCurrentUser()` returns session with fresh JWT
7. **User dictates** → Worker reads `subscription_active` claim directly (no DB query)

### User Flow After Payment

**Before Fix:**
```
Pay → DB updated → JWT unchanged (1 hour old) → Dictate → BLOCKED ❌
→ Wait 1 hour OR sign out/in → Fresh JWT → Dictate → Works ✅
```

**After Fix:**
```
Pay → DB updated → Restart app → refreshSession() → Fresh JWT → Dictate → Works ✅
Total time: ~5 seconds (time to restart)
```

**Files Modified:**
- `src/components/App.tsx` - Added refreshSession() on app startup in auth initialization useEffect (lines 493-506)

## Bugs & Issues Encountered

1. **Initial confusion about revocation vs access**
   - **Symptom:** User thought the issue was about preventing access after cancellation (revocation)
   - **Root Cause:** Actually about granting access after payment (instant activation)
   - **Clarification:** Explained that 1-hour revocation delay is acceptable and industry-standard, but 1-hour activation delay after payment is terrible UX

2. **User tried complex solutions unsuccessfully**
   - **Symptom:** User mentioned trying "something similar" that didn't work
   - **Root Cause:** Likely tried `getSession()` instead of `refreshSession()`, or put it in wrong location
   - **Fix:** Added explicit `refreshSession()` call at exact right moment (before getCurrentUser()) in app initialization

## Key Learnings

- **JWT Refresh Timing** - Supabase JWTs expire after 3600 seconds (1 hour) by default. The client auto-refreshes at ~55 minutes, but only if the session is active. On app restart from scratch, `getSession()` returns cached session without auto-refresh, so must explicitly call `refreshSession()`.

- **Custom Access Token Hook is synchronous** - When `refreshSession()` is called, Supabase immediately runs the Custom Access Token Hook (Postgres function) to check subscription status and add claims. This is not cached or delayed - it's real-time database check during token issuance.

- **Natural User Behavior as UX Solution** - Instead of complex webhook notifications or deep linking, leveraging the intuitive behavior of "restart the app" makes the solution simple and predictable. Users already do this when something doesn't work.

- **1-Hour Delay Context Matters** - The same 1-hour propagation delay has different UX implications:
  - **After cancellation:** Acceptable (users expect service until billing period ends anyway)
  - **After payment:** Unacceptable (users expect immediate access after giving money)

- **Startup Refresh Location is Critical** - Must call `refreshSession()` BEFORE `getCurrentUser()` but AFTER `getSupabase()` in the initialization flow. Putting it later or in the auth state change handler won't catch the cold start scenario.

## Architecture Decisions

- **App Startup Refresh Over Alternatives** - Chose to refresh on app startup rather than:
  - ❌ **Polling on every dictation** - Would add 100-300ms latency per dictation, defeats JWT optimization
  - ❌ **Webhook push notification** - Complex architecture, doesn't work if app is closed during payment
  - ❌ **Website redirects to app** - Requires deep linking, may not work cross-platform
  - ✅ **Startup refresh** - Simple, matches user intuition, zero latency overhead on dictations

- **Silent Failure is Acceptable** - If `refreshSession()` fails (network error, timeout), app continues with cached session. This is acceptable because:
  - User will retry on next restart
  - Worst case: they sign out/in (existing workaround)
  - Better than blocking app startup on network call

- **Skip in Dev Mode** - Only refresh when `!skipAuth` to avoid unnecessary calls during development when auth is disabled via dev flags

## Ready for Next Session

- ✅ **Payment flow end-to-end working** - Website checkout → Database update → App access all functioning with instant activation after restart
- ✅ **JWT architecture optimized** - Custom Access Token Hook reducing auth latency from ~50ms to ~1ms per dictation
- ✅ **Console logging in place** - `[App] Session refreshed on startup` log helps debug if refresh is actually happening
- 🔧 **Optional enhancement: Deep linking** - Could add `sonicflow://payment-success` handler to automatically open and refresh app from checkout success page
- 🔧 **Optional enhancement: Window focus refresh** - Could refresh JWT when app window gains focus to catch mid-session subscription changes

## Context for Future

This fix completes the critical payment UX flow that was broken by the JWT optimization. The optimization (Custom Access Token Hook) trades subscription claim freshness for performance: claims update on JWT refresh (1 hour) instead of on every dictation (real-time). This session added the missing piece: forcing refresh on app startup to ensure paying customers don't experience the 1-hour delay.

The solution is production-ready and requires no changes to the worker, website, or database. It's a pure client-side fix that leverages existing Supabase functionality. When free tier with usage limits is implemented (see `PAYMENTS_BLUEPRINT.md` Future section), the same startup refresh pattern will update `words_remaining` claims.

**Related Logs:**
- `2025-12-02_1900_payments-auth-optimization.md` - Custom JWT claims implementation
- `2025-12-02_1430_payments-worker-app-auth.md` - Worker authentication flow
- `2025-11-29_2230_payments-webhook-success.md` - Website checkout success page

**Related Plans:**
- `plans/PAYMENTS_BLUEPRINT.md` - Overall payment architecture and JWT explanation
