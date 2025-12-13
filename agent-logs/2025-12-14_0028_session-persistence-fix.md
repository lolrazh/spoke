# Session Persistence Fix - Supabase Auth Across Electron Restarts

**Date:** 2025-12-14  
**Agent:** Antigravity (Gemini)  
**Status:** ✅ Completed  

## User Intention
User wanted to fix a critical UX bug where users are forced to re-authenticate and restart onboarding from the beginning after quitting the app mid-onboarding (especially after granting screen recording permission which requires app restart on macOS). The goal was to ensure Supabase sessions persist reliably across app restarts so users remain logged in and can resume onboarding seamlessly.

## What We Accomplished
- ✅ **Fixed session injection timing** - Added `waitForSessionReady()` function that Supabase client awaits before initializing
- ✅ **Fixed contextBridge promise serialization** - Changed from bare promise to function returning promise (contextBridge can only serialize promises from functions!)
- ✅ **Added sessionSync to Onboarding window** - Session sync was only in App.tsx, but auth happens in Onboarding.tsx
- ✅ **Fixed storage file name mismatch** - Changed to use legacy `session.json` with `supabaseSession` key for backward compatibility
- ✅ **Made getSupabase() async everywhere** - All callers now properly await the async initialization
- ✅ **Added auth check to IntroExperience** - This was THE final bug: IntroExperience wasn't checking if user was already signed in!
- ✅ **Session persistence now works across restarts** - Users remain logged in and resume from saved step

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
  if (user) setVisible(false); // Skip to onboarding
}, []);
```

**Files Modified:**
- `src/preload.ts` - Session injection with waitForSessionReady function
- `src/lib/supabaseClient.ts` - Async getSupabase() with extensive logging
- `src/lib/sessionStorage.ts` - Changed to legacy file/key format for backward compat
- `src/lib/sessionSync.ts` - Made async
- `src/components/Onboarding.tsx` - Added sessionSync init, awaited getSupabase()
- `src/components/intro/IntroExperience.tsx` - **THE KEY FIX**: Added auth check to skip intro
- `src/components/App.tsx` - Awaited getSupabase() calls
- `src/components/SettingsPanel.tsx` - Awaited getSupabase() call
- `src/state/userIdentity.ts` - Made subscribeToAuthChanges async
- `src/types/electron.d.ts` - Added waitForSessionReady type

## Bugs & Issues Encountered

1. **Race condition in preload injection**
   - **Symptoms:** Supabase found empty localStorage on startup
   - **Root Cause:** Async IIFE in preload didn't block; renderer loaded before injection completed
   - **Fix:** Added promise mechanism with waitForSessionReady()

2. **contextBridge doesn't serialize bare promises**
   - **Symptoms:** window.sessionReady was undefined in renderer
   - **Root Cause:** `exposeInMainWorld("sessionReady", promise)` doesn't work
   - **Fix:** Changed to `exposeInMainWorld("waitForSessionReady", () => promise)` - functions returning promises work!

3. **sessionSync only initialized in main window**
   - **Symptoms:** Session never saved to electron-store when authenticating
   - **Root Cause:** sessionSync.initializeSessionSync() only called in App.tsx (main window), but auth happens in Onboarding.tsx (onboarding window) 
   - **Fix:** Added sessionSync init to Onboarding.tsx

4. **Wrong storage file being read**
   - **Symptoms:** New code read from empty supabase-session.json, session was in session.json
   - **Root Cause:** Different store names in new vs legacy code
   - **Fix:** Changed to use legacy format (session.json with supabaseSession key)

5. **IntroExperience never checked if user was already authenticated** 
   - **Symptoms:** Session restored, Supabase fired SIGNED_IN event, but intro still showed login button
   - **Root Cause:** IntroExperience initialized Supabase but never called getCurrentUser()
   - **Fix:** Added auth check that calls setVisible(false) to skip intro if user exists
   - **Key Insight:** User pointed to `agent-logs/2025-11-15_1758_google-login-homepage.md` which explained the intro/onboarding architecture!

## Key Learnings

- **contextBridge promise serialization is TRICKY** - Bare promises don't serialize! Only promises RETURNED FROM FUNCTIONS work across the context bridge. This is NOT well documented.

- **Multi-window Electron apps need careful coordination** - Each window (onboarding, main) has its own renderer process. Initialization code that should run in both windows must be explicitly added to both.

- **Debug logging is essential for race conditions** - Without extensive logging, we couldn't have traced where the flow was breaking. The logs showed session WAS restored but UI wasn't responding.

- **Read the previous agent logs!** - The user's instinct to check `google-login-homepage.md` was the breakthrough. That log explained that IntroExperience shows first and doesn't drive auth state - that insight led to the final fix.

- **Electron's localStorage is unreliable with file:// URLs** - In packaged builds, localStorage may not persist. Always use electron-store for critical data.

## Architecture Decisions

- **Function-based promise exposure** - Used `waitForSessionReady()` function instead of bare promise for contextBridge compatibility

- **Backward compatibility over clean slate** - Kept legacy `session.json` format instead of migrating to new format, preserving existing user sessions

- **Async getSupabase()** - Made the main accessor async to enforce waiting for session. All callers must await. Added getSupabaseSync() for special cases.

- **Auth check in IntroExperience** - Added early-exit path when user is already authenticated, skipping the intro animation entirely

## Ready for Next Session

- ✅ **Session persistence fully working** - Tested across multiple restarts
- ✅ **Backward compatible** - Existing users won't lose their sessions
- ✅ **Debug logging in place** - Can be removed once stable in production
- 🔧 **Consider removing debug logs** - Clean up verbose logging before release

## Context for Future

This fix ensures authenticated users stay logged in across app restarts, which is critical for the onboarding flow where macOS forces an app restart after granting screen recording permission. The key architectural insight is that Electron's multi-window architecture requires careful coordination: session sync must run in EVERY window where authentication might happen, and UI components must check auth state rather than assume a fresh login is needed.

**Related logs:** 
- `2025-12-13_2246_onboarding-session-persistence.md` - Earlier attempt that identified the race condition
- `2025-12-13_2258_session-persistence-debugging.md` - Intermediate debugging session
- `2025-11-15_1758_google-login-homepage.md` - Explained IntroExperience/Onboarding architecture (KEY INSIGHT!)
