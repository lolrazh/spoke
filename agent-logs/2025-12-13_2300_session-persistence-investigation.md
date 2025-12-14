# Session Persistence Investigation - Supabase Auth Across Electron Restarts

**Date:** 2025-12-13  
**Time:** 23:00  
**Agent:** Claude Sonnet 4.5  
**Status:** ⚠️ Partial - Core issues identified, infrastructure built, but final fix not achieved  

## User Intention

User wanted to solve a critical mid-onboarding restart UX problem where screen recording permission (which requires an app restart to take effect on macOS) was causing users to lose their onboarding progress. When users quit and reopened the app after granting screen recording, they would be forced to sign in again and start onboarding from scratch. Additionally, user wanted screen recording permission moved to the last position (4th) in the permissions list.

## What We Accomplished

### ✅ Completed
- **Screen Recording Repositioned** - Moved from 2nd to 4th position in both Onboarding.tsx and PermissionsPanel.tsx
- **Permission Order Updated** - New order: Microphone → Accessibility → Input Monitoring → Screen Recording
- **Root cause identified** - Electron's `localStorage` is unreliable with `file://` URLs in packaged builds (works in dev, fails in production)
- **Local flag sync with database** - When user authenticates, local `onboarding.json` flag now syncs with DB `onboarding_done` state
- **Onboarding step persistence** - Current step saved to local file and restored on restart
- **Session ready mechanism** - Created `waitForSessionReady()` function with promise to coordinate timing
- **Async getSupabase()** - Made `getSupabase()` async to await session injection before client creation
- **sessionSync added to Onboarding** - Session sync was only in App.tsx, added to Onboarding.tsx where auth happens
- **contextBridge promise issue fixed** - Changed bare promise to function returning promise (contextBridge can only serialize promises from functions!)

### ❌ Not Yet Resolved
- **Session persistence** - Despite all infrastructure fixes, sessions still don't persist across restarts

## Technical Implementation

### Phase 1: Permission Reordering & Step Persistence

**Permission Reordering (✅ Working)**
- Moved screen recording from 2nd to 4th position
- New order: Mic → Accessibility → Input Monitoring → Screen Recording
- Updated both Onboarding.tsx and PermissionsPanel.tsx

**Step Persistence (✅ Working)**
- Problem: When user restarts mid-onboarding (e.g., on "permissions" step), app defaulted to "name-verification" step
- Solution: Save current step to `onboardingPrefs.currentStep` and restore on mount
- Added IPC handlers `onboarding:get-step` and `onboarding:set-step`

**Local Flag Sync (✅ Working)**
- Problem: User could reset DB `onboarding_done` to `false` for testing, but local flag stayed `true`
- Solution: Added `onboarding:reset-local-flag` IPC handler called when auth check detects `onboarding_done: false` in database

### Phase 2: electron-store Based Session Storage

**Approach: Custom Supabase Storage Adapter using electron-store**

Created a custom storage adapter that routes Supabase's session storage through IPC to main process, using `electron-store` (file-based JSON) instead of unreliable localStorage:

```typescript
// src/lib/sessionStorage.ts - electron-store based session storage
const electronStorageAdapter = {
  getItem: async (key: string) => window.sessionStorage.getItem(key),
  setItem: async (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: async (key: string) => window.sessionStorage.removeItem(key),
};

// Passed to Supabase:
storage: electronStorageAdapter,
```

**Why This Approach Failed Initially:**
- App launches, music plays, but onboarding window never appears
- The async storage adapter caused a race condition during Supabase initialization
- Supabase calls `getItem()` synchronously during `createClient()`, but our adapter was async

### Phase 3: "Wait at the Mailbox" Pattern

**Solution Architecture:**
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
- `src/main.ts` - Added IPC handlers for session storage, step persistence, local flag reset
- `src/preload.ts` - Session injection with waitForSessionReady function, step get/set methods
- `src/lib/sessionStorage.ts` (NEW) - electron-store based session storage
- `src/lib/sessionSync.ts` (NEW) - Listen to auth state changes and sync to electron-store
- `src/lib/supabaseClient.ts` - Async getSupabase() with extensive logging
- `src/components/Onboarding.tsx` - Added sessionSync init, step persistence, local flag sync
- `src/components/App.tsx` - Awaited getSupabase() calls
- `src/components/SettingsPanel.tsx` - Awaited getSupabase() call
- `src/components/intro/IntroExperience.tsx` - Awaited getSupabase() call
- `src/state/userIdentity.ts` - Made subscribeToAuthChanges async
- `src/types/electron.d.ts` - Added all new type definitions

## Bugs & Issues Encountered

### 1. Supabase Session Loss on App Restart
- **Symptom:** When user quits and reopens app mid-onboarding, Supabase session is not found
- **Root Cause:** Electron's localStorage is unreliable with `file://` URLs in packaged builds
- **Status:** Infrastructure in place, but still not fully working

### 2. Race condition in preload injection
- **Symptom:** Supabase found empty localStorage on startup
- **Root Cause:** Async IIFE in preload didn't block; renderer loaded before injection completed
- **Fix:** Added promise mechanism with waitForSessionReady()

### 3. contextBridge doesn't serialize bare promises
- **Symptom:** window.sessionReady was undefined in renderer
- **Root Cause:** `exposeInMainWorld("sessionReady", promise)` doesn't work!
- **Fix:** Changed to `exposeInMainWorld("waitForSessionReady", () => promise)` - functions returning promises work

### 4. sessionSync only initialized in main window
- **Symptom:** Session never saved to electron-store when authenticating
- **Root Cause:** sessionSync.initializeSessionSync() only called in App.tsx, but auth happens in Onboarding.tsx
- **Fix:** Added sessionSync init to Onboarding.tsx

### 5. Wrong storage file being read
- **Symptom:** New code read from empty supabase-session.json, session was in session.json
- **Root Cause:** Different store names in new vs legacy code
- **Fix:** Changed to use legacy format (session.json with supabaseSession key)

### 6. Step Restoration Timing Race Condition
- **Symptom:** Two separate useEffects racing - one restoring step, one checking auth
- **Fix:** Merged into single coordinated flow that checks saved step first, then auth status

### 7. electron-store file naming confusion
- **Symptom:** Session data saved to `session.json` under nested key instead of dedicated file
- **Root Cause:** Multiple Store instances without proper schema
- **Fix:** Added typed schema with proper defaults

## Key Learnings

### Architecture Deep Dive

**The Two-Flag System:**
1. **Database flag** (`profiles.onboarding_done`): Set when user completes onboarding, checked only during authentication
2. **Local flag** (`onboardingPrefs.done`): Set when `onboardingComplete()` IPC is called, checked at app startup to decide which window to open

**Critical Flow Understanding:**
- Startup decision (main vs onboarding window) uses LOCAL flag ONLY
- Database flag is ONLY checked AFTER authenticating in onboarding component
- If local flag says "done", you never get to the component that checks database
- This means they can get out of sync when dev manually resets DB for testing

**The "Let Them In" Quirk:**
- When onboarding component's auth check sees `onboarding_done: true`, it calls `onboardingComplete()`
- This sets local flag AND opens main window, even from within onboarding window

### Electron-Specific Gotchas

- **localStorage unreliable:** With `file://` URLs in packaged Electron apps, localStorage doesn't persist reliably
- **Preload async is non-blocking:** Async IIFE in preload continues execution, doesn't block renderer initialization
- **electron-store file sharing:** Multiple Store instances without unique names/schemas can collide
- **contextBridge promise serialization:** Bare promises don't serialize! Only promises RETURNED FROM FUNCTIONS work
- **Multi-window complexity:** Each Electron window has its own renderer process. Code that should run in both windows needs initialization in both!

### macOS Permission Quirks

- **Screen Recording is unique** - It's the ONLY permission that requires a full app restart to take effect
- **Others work immediately** - Mic, accessibility, input monitoring work right after grant

## Architecture Decisions

- **Screen Recording Last:** Make screen recording the final permission in the flow since it's the only one requiring restart
- **Local File for Step State:** Chose `onboarding.json` file persistence over database calls for step tracking
- **Function-based promise exposure:** Used `waitForSessionReady()` function instead of bare promise for contextBridge compatibility
- **Backward compatibility:** Kept legacy `session.json` format instead of migrating to new format
- **Async getSupabase():** Made the main accessor async to enforce waiting for session
- **Dual persistence:** Step saved to local file, session saved to electron-store

## Ready for Next Session

- ✅ **Session data IS being saved** - Verified `session.json` contains valid session data
- ✅ **Infrastructure is in place** - waitForSessionReady mechanism, async getSupabase, sessionSync in both windows
- ✅ **Onboarding step persistence** - Works correctly, ready to use
- ✅ **Local flag sync** - Prevents main window from opening when DB says onboarding incomplete
- 🔧 **Need to debug LOAD side** - Session saves correctly but may not be loading correctly
- 🔧 **Verify waitForSessionReady works** - Need logging to confirm function is being called and resolving

## Context for Future

This work solved the **step restoration** problem (user can now resume onboarding from correct step after restart), but **session persistence** across full app restarts needs one more piece. The save side works (verified session.json has data). The problem is on the load side - either:
1. Session not being loaded correctly
2. Session loaded but Supabase not recognizing it
3. Another timing issue not yet identified

The onboarding architecture investigation revealed important quirks about the two-flag system that should inform any future auth/onboarding changes. The critical unresolved question: Why doesn't the injected session get picked up by Supabase even though data is in localStorage?

**Previous related investigation:** This log consolidates findings from multiple debugging sessions on 2025-12-13.
