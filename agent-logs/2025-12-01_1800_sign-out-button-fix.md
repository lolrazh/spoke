# Fix Sign-Out Button Not Working

**Date:** 2025-12-01
**Agent:** Claude (Opus 4.5)
**Status:** ✅ Completed

## User Intention
User reported that clicking the Sign Out button in the settings panel did nothing - the panel would close, but the app would remain signed in. Sometimes sign-out would happen randomly 1-2 minutes later. The behavior worked perfectly in dev but was broken in prod.

**Key finding:** The bug was **stateful** - first sign-out after fresh install worked, but subsequent sign-outs failed. This pointed to state corruption in the Supabase auth listener.

## What We Accomplished
- ✅ **Fixed state machine to handle NOTIFY while EXPANDED** - The pill state machine now properly transitions from EXPANDED → NOTIFICATION when a notification is dispatched (e.g., "Signed out")
- ✅ **Added loading state to Sign Out button** - Prevents double-clicks and shows "Signing out…" feedback while the async operation completes
- ✅ **Fixed handleSignOut to await supaSignOut()** - The sign-out function now properly awaits the Supabase sign-out call before any UI transitions
- ✅ **Added prevUserIdRef update in polling handler** - Prevents duplicate sign-out triggers from the 60-second polling mechanism
- ✅ **Deferred Supabase operations in onAuthStateChange** - The critical fix! Wrapped all Supabase calls inside `setTimeout(fn, 0)` to prevent breaking the auth listener

## Root Cause Analysis

### Bug #1: State Machine Ignored NOTIFY While Expanded
When clicking Sign Out while the settings panel was expanded:
1. `supaSignOut()` was called
2. `onAuthStateChange` fired with `SIGNED_OUT` event
3. Handler sent "Signed out" notification and set `pendingHideAfterCollapse`
4. **BUT** the pill was in `EXPANDED` state and the state machine **ignored** the `NOTIFY` event
5. The notification was never shown, and `pendingHideAfterCollapse` never triggered

**Fix:** Added NOTIFY handling to the EXPANDED state in the pill state machine.

### Bug #2: onAuthStateChange Listener Broke After First Sign-Out (THE CRITICAL BUG)
According to [Supabase docs](https://supabase.com/docs/client/auth-onauthstatechange):
> "Executing Supabase operations directly within the onAuthStateChange callback can lead to issues, including the listener not firing as expected."

We were doing exactly this:
- `userIdentity.ts`: Called `refreshIdentity()` (which queries Supabase) inside the callback
- `App.tsx`: Called `loadSharePreference()` (which queries Supabase) inside the callback

After the first sign-in/sign-out cycle, the auth listener would silently break and stop firing events.

**Fix:** Wrapped all Supabase operations in `setTimeout(fn, 0)` to defer them outside the callback.

### Why 1-2 Minute Delay
The app has a 60-second polling interval (`window.setInterval`) that checks `supabase.auth.getUser()`. When this polling detected no user, it would trigger the sign-out flow - explaining the delayed sign-out.

### Why First Sign-Out Worked But Second Didn't
1. **First sign-in**: Auth listener registers, works fine
2. **First sign-out**: Fires correctly, but the Supabase operations inside the callback corrupt the listener
3. **Second sign-in**: Listener already broken, doesn't fire reliably
4. **Second sign-out**: Listener doesn't fire → no notification → stuck on "Signing out..."

## Technical Implementation

### State Machine Fix (App.tsx)
```typescript
case "EXPANDED":
  if (event.type === "COLLAPSE") return { ...state, state: "IDLE" };
  if (event.type === "PTT_START") return { ...state, state: "LISTENING" };
  // NEW: Handle NOTIFY while expanded (e.g., sign-out from settings panel)
  if (event.type === "NOTIFY")
    return {
      state: "NOTIFICATION",
      context: {
        ...state.context,
        notifMsg: event.msg,
        notifAction: event.actionId ?? null,
      },
    };
  return state;
```

### handleSignOut Fix (SettingsPanel.tsx)
```typescript
const handleSignOut = async () => {
  if (isSigningOut) return; // Prevent double-clicks
  setIsSigningOut(true);
  
  try {
    // Sign out and wait for completion
    // The onAuthStateChange listener in App.tsx will:
    // 1. Send "Signed out" notification (transitions pill EXPANDED → NOTIFICATION)
    // 2. Set pendingHideAfterCollapse to show onboarding after notification
    await supaSignOut();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Failed to sign out:", msg);
    setIsSigningOut(false);
  }
};
```

### Loading State UI
```tsx
<Button 
  variant="secondary" 
  size="sm" 
  onClick={handleSignOut}
  disabled={isSigningOut}
>
  {isSigningOut ? "Signing out…" : "Sign Out"}
</Button>
```

### Deferred Supabase Operations (userIdentity.ts)
```typescript
// BEFORE (broken):
supabase.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_IN") {
    await refreshIdentity();  // ❌ Supabase call inside callback
  }
});

// AFTER (fixed):
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN") {
    setTimeout(() => {
      refreshIdentity().catch(console.warn);  // ✅ Deferred
    }, 0);
  }
});
```

### Deferred Supabase Operations (App.tsx)
```typescript
// BEFORE (broken):
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN") {
    loadSharePreference(userId);  // ❌ Eventually calls Supabase
  }
});

// AFTER (fixed):
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN") {
    setTimeout(() => loadSharePreference(userId), 0);  // ✅ Deferred
  }
});
```

## Files Modified
- `src/components/App.tsx` - State machine fix + deferred Supabase calls in auth listener
- `src/components/SettingsPanel.tsx` - handleSignOut async fix, loading state, button UI
- `src/state/userIdentity.ts` - Deferred refreshIdentity() call in auth listener

## Key Learnings

1. **NEVER call Supabase operations inside onAuthStateChange** - This is documented behavior! The Supabase client can break if you do async Supabase operations in the callback. Always use `setTimeout(fn, 0)` to defer.

2. **State machines must handle all valid events** - The EXPANDED state ignoring NOTIFY was a design oversight. Any state that can receive async events needs explicit handling.

3. **Fire-and-forget async patterns are dangerous** - The original code wrapped `supaSignOut()` in an IIFE without awaiting, then immediately collapsed the UI. This created a race condition.

4. **Stateful bugs need cycle testing** - First sign-in/sign-out worked, second didn't. Always test multiple cycles of state transitions.

5. **Loading states prevent user confusion** - Showing "Signing out…" gives immediate feedback that something is happening, even if the async operation takes time.

## Flow After Fix

1. User clicks "Sign Out" button
2. Button disables, shows "Signing out…"
3. `supaSignOut()` is awaited
4. Supabase fires `onAuthStateChange` with no session
5. Handler sends "Signed out" notification
6. State machine transitions: EXPANDED → NOTIFICATION
7. Notification displays for 2 seconds
8. `pendingHideAfterCollapse` triggers hide + show onboarding
9. User sees onboarding window

## Context for Future

The `onRequestCollapse` prop in SettingsPanel is now preserved for API compatibility but unused. The sign-out flow is entirely handled by the auth state machine in App.tsx. If any future features need to collapse from SettingsPanel with a notification, they should follow this same pattern: trigger the notification first, let the state machine handle the transition.
