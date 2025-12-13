# Session Persistence Debugging - Supabase Auth Across Restarts

**Date:** 2025-12-13  
**Agent:** Antigravity (Gemini)  
**Status:** ⚠️ Partial - Core issues identified but not fully resolved  

## User Intention
User wanted to fix a critical UX bug where users are forced to re-authenticate and restart onboarding from the beginning after quitting the app mid-onboarding (especially after granting screen recording permission which requires app restart on macOS). The goal was to ensure Supabase sessions persist across app restarts so users remain logged in and can resume onboarding from where they left off.

## What We Accomplished
- ✅ **Identified root cause** - Electron's `localStorage` is unreliable with `file://` URLs in packaged builds
- ✅ **Understood the race condition** - Supabase client reads `localStorage` before session injection completes
- ✅ **Added session ready mechanism** - Created `waitForSessionReady()` function with promise to coordinate timing
- ✅ **Fixed async getSupabase()** - Made `getSupabase()` async to await session injection before client creation
- ✅ **Added sessionSync to Onboarding** - Session sync was only in App.tsx, added to Onboarding.tsx where auth happens
- ✅ **Fixed storage file mismatch** - Changed from `supabase-session.json` to `session.json` for backward compatibility
- ✅ **Fixed contextBridge promise issue** - Bare promises don't serialize; changed to function returning promise
- ⚠️ **Session persistence still not working** - Despite all fixes, the session doesn't persist across restarts

## Technical Implementation

### The "Wait at the Mailbox" Pattern
```
Timeline (Fixed):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0ms    Preload starts fetching session from electron-store...
       Supabase waits for waitForSessionReady() 🕐
50ms   Session injected into localStorage ✓
51ms   Supabase creates client → reads from localStorage → SHOULD find session!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Files Modified:**
- `src/preload.ts` - Added sessionReady promise mechanism with contextBridge-compatible function
- `src/lib/supabaseClient.ts` - Made `getSupabase()` async, waits for `waitForSessionReady()`
- `src/lib/sessionStorage.ts` - Changed store name to "session" and key to "supabaseSession" for backward compat
- `src/lib/sessionSync.ts` - Made `initializeSessionSync()` async
- `src/components/Onboarding.tsx` - Added sessionSync initialization (was only in App.tsx!)
- `src/components/App.tsx` - Added await to getSupabase() calls
- `src/components/SettingsPanel.tsx` - Added await to getSupabase() call
- `src/components/intro/IntroExperience.tsx` - Added await to getSupabase() call
- `src/state/userIdentity.ts` - Made subscribeToAuthChanges async
- `src/types/electron.d.ts` - Added `waitForSessionReady` type definition

## Bugs & Issues Encountered

1. **Race condition in preload injection** - Async IIFE in preload wasn't blocking; Supabase initialized before data was ready
   - **Fix:** Added `waitForSessionReady()` promise that resolves after injection completes

2. **sessionSync only in main window** - Auth happens in Onboarding window, but sessionSync was only initialized in App.tsx
   - **Fix:** Added sessionSync initialization to Onboarding.tsx

3. **Wrong storage file name** - Code looked in `supabase-session.json` but data was in `session.json` (legacy)
   - **Fix:** Changed to use `session.json` with `supabaseSession` key format

4. **contextBridge doesn't serialize bare promises** - `exposeInMainWorld("sessionReady", promise)` doesn't work!
   - **Fix:** Changed to `exposeInMainWorld("waitForSessionReady", () => promise)` - functions returning promises work

5. **UNRESOLVED: Session still not persisting** - All above fixes applied but login still required after restart
   - **Current state:** Session IS being saved to `session.json` (verified), but either:
     - It's not being loaded correctly
     - It's being loaded but Supabase isn't recognizing it
     - There's another timing issue we haven't found

## Key Learnings

- **contextBridge promise serialization** - Bare promises exposed via `exposeInMainWorld()` don't work! Only promises RETURNED FROM FUNCTIONS serialize correctly across the context bridge.

- **electron-store file naming** - Store name becomes the JSON filename: `new Store({ name: "session" })` → `session.json`

- **Session data location** - Supabase session is stored in localStorage with key pattern `sb-{project_ref}-auth-token`

- **Multi-window complexity** - Each Electron window (onboarding, main) has its own renderer process. Code that should run in both windows needs to be initialized in both!

- **Async useEffect timing** - Multiple async useEffects run concurrently. Order of declaration doesn't guarantee order of execution of their async bodies.

## Architecture Decisions

- **Function-based promise exposure** - Used `waitForSessionReady()` function instead of bare promise for contextBridge compatibility

- **Backward compatibility over clean slate** - Kept legacy `session.json` format instead of migrating to new format, avoiding breaking existing user sessions

- **Async getSupabase()** - Made the main accessor async to enforce waiting for session. All callers now must await it.

## Ready for Next Session

- ✅ **Session data IS being saved** - Verified `session.json` contains valid session data
- ✅ **Infrastructure is in place** - waitForSessionReady mechanism, async getSupabase, sessionSync in both windows
- 🔧 **Need to debug LOAD side** - Add console.logs to trace exactly what happens during session injection on restart
- 🔧 **Verify waitForSessionReady works** - Log in preload to confirm function is being called and resolving

## Context for Future

The save side is working (verified session.json has data). The problem is on the load side. Next session should:

1. Add extensive logging to:
   - Preload script: log when session:get-all is called and what it returns
   - supabaseClient.ts: log when waitForSessionReady is called and when it resolves
   - Log localStorage contents before and after injection
   - Log what Supabase's getSession() returns after client creation

2. Test in dev mode with DevTools open to see all logs

3. Consider: Is the packaged app's preload script actually running the new code? (check build output)

4. Alternative approach if current method fails: Sync the Supabase session AFTER client init by calling `supabase.auth.setSession()` manually with data from electron-store

**Previous related logs:** `2025-12-13_2246_onboarding-session-persistence.md`, `2025-12-13_1430_onboarding-restart-persistence.md`
