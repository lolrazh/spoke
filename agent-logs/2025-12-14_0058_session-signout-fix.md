# Complete Session Persistence & Sign-Out Flow Fix

**Date:** 2025-12-14  
**Agent:** Antigravity (Gemini)  
**Status:** ✅ Completed  

## User Intention
User wanted to fix a critical UX bug where users are forced to re-authenticate after restarting the app mid-onboarding. After fixing session persistence, additional issues emerged:
1. Sign-out didn't properly clear the session (users would auto-sign back in)
2. Flash of login page on restart (even when already signed in)  
3. Empty page content when resuming onboarding from saved step

The user's keen instinct to check the PR diff and previous agent logs was crucial in identifying the root causes.

## What We Accomplished

### Session Persistence (from earlier session)
- ✅ **Preload session injection** - Session data from electron-store injected into localStorage before Supabase reads
- ✅ **waitForSessionReady()** - Exposed as function (not bare promise) for contextBridge compatibility
- ✅ **Async getSupabase()** - Now waits for session injection before client creation
- ✅ **Backward compatible storage** - Uses legacy `session.json` with `supabaseSession` key

### Sign-Out Fix
- ✅ **session:clear-all IPC handler** - New handler to clear all session data from electron-store
- ✅ **sessionSync clearAll()** - On SIGNED_OUT event, now calls clearAll() instead of iterating empty localStorage
- ✅ **Proper sign-out flow** - Session is now properly cleared from electron-store on logout

### Flash of Login Page Fix
- ✅ **checkingAuth state** - IntroExperience now waits for auth check before rendering anything
- ✅ **Direct onFinish() call** - When user is already signed in, call onFinish() directly instead of relying on AnimatePresence exit

### Empty Page Content Fix
- ✅ **Call onFinish() directly** - AnimatePresence's onExitComplete doesn't fire if nothing was ever rendered (checkingAuth was true)
- ✅ **useCallback for handleIntroFinish** - Memoized to prevent re-render loops when passed as dependency

## Technical Implementation

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

**Files Modified:**
- `src/main.ts` - Added session:clear-all IPC handler, imported clearAllSessionData
- `src/preload.ts` - Added clearAll to supabaseSession bridge
- `src/types/electron.d.ts` - Added clearAll type
- `src/lib/sessionSync.ts` - Fixed SIGNED_OUT to call clearAll() directly
- `src/components/intro/IntroExperience.tsx` - Added checkingAuth state, call onFinish directly for signed-in users
- `src/components/Onboarding.tsx` - Added useCallback import, memoized handleIntroFinish

## Bugs & Issues Encountered

1. **Sign-out doesn't clear electron-store**
   - **Symptoms:** After signing out and reopening, user is automatically signed back in
   - **Root Cause:** sessionSync tried to iterate localStorage for keys to remove, but Supabase had already cleared it!
   - **Fix:** Call `clearAll()` directly on electron-store instead of iterating

2. **Flash of login page on restart**
   - **Symptoms:** Brief flash of Google sign-in button before skipping to main app
   - **Root Cause:** IntroExperience rendered immediately, then checked auth, then hid
   - **Fix:** Added `checkingAuth` state - don't render until auth check completes

3. **Empty page when resuming saved step**
   - **Symptoms:** Pagination shows but no page content
   - **Root Cause:** AnimatePresence's `onExitComplete` doesn't fire if nothing was ever rendered. When `checkingAuth=true`, nothing rendered, so `setVisible(false)` had nothing to animate out.
   - **Fix:** When user IS signed in, call `onFinish()` directly instead of `setVisible(false)`

4. **useCallback import missing**
   - **Symptoms:** TypeScript error "Cannot find name 'useCallback'"
   - **Fix:** Added useCallback to React imports in Onboarding.tsx

## Key Learnings

- **AnimatePresence onExitComplete only fires after an actual exit animation** - If no content was ever rendered (conditional rendering), there's nothing to animate out, so `onExitComplete` never fires!

- **Sign-out clears localStorage BEFORE onAuthStateChange fires** - Can't rely on iterating localStorage keys in the auth listener; they're already gone.

- **User instincts are valuable** - The user's suggestion to check previous agent logs (`google-login-homepage.md`) led to the breakthrough insight about the IntroExperience/Onboarding architecture.

- **Debug logging is essential** - The verbose logs we added earlier showed exactly where the flow was breaking: `[Auth] Session ready`, `[SessionSync] Auth event: SIGNED_IN`, etc.

## Architecture Decisions

- **clearAll() over iterate** - More reliable to clear everything than to find and remove individual keys, especially when source (localStorage) is already cleared

- **Direct onFinish() call over AnimatePresence** - When we know user is signed in during auth check, calling onFinish directly is more reliable than relying on animation lifecycle

- **checkingAuth state** - Prevents any flash by not rendering until we know the auth state

- **useCallback for callbacks passed to children** - Prevents unnecessary re-renders and useEffect re-triggers

## Ready for Next Session

- ✅ **Session persistence fully working** - Tested restart from permissions page
- ✅ **Sign-out properly clears session** - No more auto-sign-back-in
- ✅ **No flash of login page** - Clean transition on restart
- ✅ **Saved step resumption works** - Page content shows correctly
- 🔧 **Consider removing debug logs** - Many verbose logs added during debugging

## Context for Future

This session completed the full session persistence feature:
1. **Save:** Session synced to electron-store on auth changes
2. **Load:** Session injected into localStorage before Supabase init
3. **Clear:** Session properly cleared from electron-store on sign-out
4. **Resume:** Onboarding correctly skips intro and resumes from saved step

The key insight was understanding the AnimatePresence lifecycle - `onExitComplete` only fires after an actual exit animation, not when content was conditionally prevented from rendering in the first place.

**Related logs:**
- `2025-12-14_0028_session-persistence-fix.md` - Earlier fix attempt (session save/load)
- `2025-12-13_2258_session-persistence-debugging.md` - Debugging session
- `2025-11-15_1758_google-login-homepage.md` - IntroExperience architecture (crucial insight!)
