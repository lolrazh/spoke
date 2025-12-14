# Session Persistence Complete - Supabase Auth Across Electron Restarts

**Date:** 2025-12-14  
**Time:** 01:00  
**Agent:** Claude Opus 4.5  
**Status:** ✅ Completed  

## User Intention

User wanted to fix a critical UX bug where users are forced to re-authenticate and restart onboarding from the beginning after quitting the app mid-onboarding (especially after granting screen recording permission which requires app restart on macOS). The goal was to ensure Supabase sessions persist reliably across app restarts so users remain logged in and can resume onboarding seamlessly.

## What We Accomplished

### Session Persistence Infrastructure
- ✅ **Preload session injection** - Session data from electron-store injected into localStorage before Supabase reads
- ✅ **waitForSessionReady()** - Exposed as function (not bare promise) for contextBridge compatibility
- ✅ **Async getSupabase()** - Now waits for session injection before client creation
- ✅ **Backward compatible storage** - Uses legacy `session.json` with `supabaseSession` key

### The Final Bug Fix
- ✅ **Auth check in IntroExperience** - This was THE breakthrough: IntroExperience wasn't checking if user was already signed in!
- ✅ **Session persistence now works across restarts** - Users remain logged in and resume from saved step

### Sign-Out Fix
- ✅ **session:clear-all IPC handler** - New handler to clear all session data from electron-store
- ✅ **sessionSync clearAll()** - On SIGNED_OUT event, now calls clearAll() instead of iterating empty localStorage
- ✅ **Proper sign-out flow** - Session is now properly cleared from electron-store on logout

### Flash of Login Page Fix
- ✅ **checkingAuth state** - IntroExperience now waits for auth check before rendering anything
- ✅ **Direct onFinish() call** - When user is already signed in, call onFinish() directly instead of relying on AnimatePresence exit

### Empty Page Content Fix
- ✅ **Call onFinish() directly** - AnimatePresence's onExitComplete doesn't fire if nothing was ever rendered
- ✅ **useCallback for handleIntroFinish** - Memoized to prevent re-render loops when passed as dependency

## Technical Implementation

### The Core Problem: Multi-Layer Race Condition

There were actually FOUR separate issues, each masking the next:

```
Layer 1: Race condition in preload injection (session read before injection)
    ↓ Fixed with waitForSessionReady() promise
Layer 2: contextBridge can't serialize bare promises
    ↓ Fixed by using function that returns promise
Layer 3: SessionSync only ran in main window, not onboarding window
    ↓ Fixed by adding init to Onboarding.tsx
Layer 4: IntroExperience never checked if user was already authenticated!
    ↓ Fixed by adding getCurrentUser() check that skips intro
```

### Solution Architecture: "Wait at the Mailbox" Pattern

```typescript
// preload.ts - expose function (not bare promise!)
contextBridge.exposeInMainWorld("waitForSessionReady", () => sessionReadyPromise);

// supabaseClient.ts - wait for injection before creating client
export async function getSupabase() {
  await window.waitForSessionReady(); // Wait for localStorage to be populated
  client = createClient(...);         // Now Supabase reads the restored session
}

// IntroExperience.tsx - skip intro if already signed in
useEffect(() => {
  const user = await getCurrentUser();
  if (user) onFinish(); // Skip to onboarding directly
}, []);
```

### The Sign-Out Bug

```
Before:
1. User clicks Sign Out
2. supabase.auth.signOut() clears localStorage
3. onAuthStateChange fires with session=null
4. sessionSync tries to iterate localStorage.filter('sb-')
5. No keys found (already cleared!) → nothing removed from electron-store
6. User reopens app → old session injected from electron-store → auto-signed-in!

After:
1. User clicks Sign Out
2. supabase.auth.signOut() clears localStorage
3. onAuthStateChange fires with session=null
4. sessionSync calls clearAll() directly
5. electron-store is wiped clean
6. User reopens app → no session → login required ✓
```

### The Empty Page Bug

```
Before:
1. App restarts with saved step "permissions"
2. IntroExperience mounts with checkingAuth=true → nothing renders
3. Auth check finds user → setVisible(false)
4. checkingAuth is still true → nothing was ever rendered
5. AnimatePresence has nothing to animate out
6. onExitComplete never fires → showIntro stays true
7. Main content requires !showIntro → nothing shows!

After:
1. Auth check finds user → call onFinish() directly
2. onFinish sets showIntro=false
3. Main content renders with restored step ✓
```

### Files Modified

**Session Infrastructure:**
- `src/main.ts` - IPC handlers: session:get-all, session:set, session:remove, session:clear-all
- `src/preload.ts` - Session injection with waitForSessionReady function, supabaseSession bridge
- `src/lib/sessionStorage.ts` - electron-store based session storage with clearAllSessionData()
- `src/lib/sessionSync.ts` - Auth state listener that syncs to electron-store, calls clearAll on sign-out
- `src/lib/supabaseClient.ts` - Async getSupabase() with extensive logging
- `src/types/electron.d.ts` - All session-related type definitions

**UI Components:**
- `src/components/Onboarding.tsx` - Added sessionSync init, useCallback for handleIntroFinish
- `src/components/intro/IntroExperience.tsx` - **THE KEY FIX**: Added auth check, checkingAuth state, direct onFinish call
- `src/components/App.tsx` - Awaited getSupabase() calls
- `src/components/SettingsPanel.tsx` - Awaited getSupabase() call
- `src/state/userIdentity.ts` - Made subscribeToAuthChanges async

## Bugs & Issues Encountered

### 1. IntroExperience never checked if user was already authenticated
- **Symptoms:** Session restored, Supabase fired SIGNED_IN event, but intro still showed login button
- **Root Cause:** IntroExperience initialized Supabase but never called getCurrentUser()
- **Fix:** Added auth check that calls onFinish() directly to skip intro if user exists
- **Key Insight:** User pointed to `agent-logs/2025-11-15_1758_google-login-homepage.md` which explained the intro/onboarding architecture!

### 2. Sign-out doesn't clear electron-store
- **Symptoms:** After signing out and reopening, user is automatically signed back in
- **Root Cause:** sessionSync tried to iterate localStorage for keys to remove, but Supabase had already cleared it!
- **Fix:** Call `clearAll()` directly on electron-store instead of iterating

### 3. Flash of login page on restart
- **Symptoms:** Brief flash of Google sign-in button before skipping to main app
- **Root Cause:** IntroExperience rendered immediately, then checked auth, then hid
- **Fix:** Added `checkingAuth` state - don't render until auth check completes

### 4. Empty page when resuming saved step
- **Symptoms:** Pagination shows but no page content
- **Root Cause:** AnimatePresence's `onExitComplete` doesn't fire if nothing was ever rendered. When `checkingAuth=true`, nothing rendered, so `setVisible(false)` had nothing to animate out.
- **Fix:** When user IS signed in, call `onFinish()` directly instead of `setVisible(false)`

### 5. useCallback import missing
- **Symptoms:** TypeScript error "Cannot find name 'useCallback'"
- **Fix:** Added useCallback to React imports in Onboarding.tsx

## Key Learnings

### Animation Lifecycle Gotchas

- **AnimatePresence onExitComplete only fires after an actual exit animation** - If no content was ever rendered (conditional rendering with checkingAuth=true), there's nothing to animate out, so `onExitComplete` never fires!

### Session Management

- **Sign-out clears localStorage BEFORE onAuthStateChange fires** - Can't rely on iterating localStorage keys in the auth listener; they're already gone
- **clearAll() over iterate** - More reliable to clear everything than to find and remove individual keys

### Multi-Window Architecture

- **Each Electron window has its own renderer** - Session sync must run in EVERY window where authentication might happen
- **UI components must check auth state** - Don't assume a fresh login is needed

### Debugging Approach

- **Read the previous agent logs!** - The user's instinct to check `google-login-homepage.md` was the breakthrough. That log explained that IntroExperience shows first and doesn't drive auth state
- **Debug logging is essential for race conditions** - Without extensive logging, we couldn't have traced where the flow was breaking

## Architecture Decisions

- **Function-based promise exposure** - Used `waitForSessionReady()` function instead of bare promise for contextBridge compatibility
- **Backward compatibility** - Kept legacy `session.json` format instead of migrating, preserving existing user sessions
- **Async getSupabase()** - Made the main accessor async to enforce waiting for session. Added getSupabaseSync() for special cases
- **Auth check in IntroExperience** - Added early-exit path when user is already authenticated, skipping the intro animation entirely
- **Direct onFinish() call over AnimatePresence** - When we know user is signed in during auth check, calling onFinish directly is more reliable than relying on animation lifecycle
- **checkingAuth state** - Prevents any flash by not rendering until we know the auth state
- **useCallback for callbacks passed to children** - Prevents unnecessary re-renders and useEffect re-triggers

## Complete Session Persistence Flow

The final working architecture:

### 1. Save (on auth state change)
```
User authenticates → Supabase fires onAuthStateChange
    → sessionSync catches SIGNED_IN event
    → Reads all 'sb-*' keys from localStorage
    → Saves to electron-store via IPC
```

### 2. Load (on app restart)
```
App starts → Preload script runs
    → Reads session from electron-store via IPC
    → Injects into localStorage
    → Resolves waitForSessionReady promise
    → getSupabase() awaits this, then creates client
    → Supabase reads session from localStorage → User is authenticated!
```

### 3. Clear (on sign-out)
```
User signs out → Supabase fires onAuthStateChange with session=null
    → sessionSync catches SIGNED_OUT event
    → Calls clearAll() on electron-store
    → User reopens app → no session → login required
```

### 4. Resume (onboarding step)
```
App starts with saved step → IntroExperience mounts
    → checkingAuth=true (nothing renders yet)
    → Calls getCurrentUser()
    → User found → calls onFinish() directly
    → showIntro=false → Onboarding renders with restored step
```

## Ready for Next Session

- ✅ **Session persistence fully working** - Tested across multiple restarts
- ✅ **Sign-out properly clears session** - No more auto-sign-back-in
- ✅ **No flash of login page** - Clean transition on restart
- ✅ **Saved step resumption works** - Page content shows correctly
- ✅ **Backward compatible** - Existing users won't lose their sessions
- 🔧 **Consider removing debug logs** - Many verbose logs added during debugging can be cleaned up

## Context for Future

This fix ensures authenticated users stay logged in across app restarts, which is critical for the onboarding flow where macOS forces an app restart after granting screen recording permission. 

The key architectural insights:
1. **Electron's multi-window architecture requires careful coordination** - Session sync must run in EVERY window where authentication might happen
2. **UI components must check auth state** rather than assume a fresh login is needed
3. **AnimatePresence lifecycle is tricky** - onExitComplete only fires after actual exit animations, not when content was conditionally prevented from rendering

**Related logs:**
- `2025-12-13_2300_session-persistence-investigation.md` - Investigation that built the infrastructure
- `2025-11-15_1758_google-login-homepage.md` - Explained IntroExperience/Onboarding architecture (KEY INSIGHT!)
