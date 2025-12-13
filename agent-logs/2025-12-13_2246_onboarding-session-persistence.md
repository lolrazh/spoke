# Onboarding Session Persistence Investigation

**Date:** 2025-12-13  
**Agent:** Claude 3.5 Sonnet (Thinking)  
**Status:** ⚠️ Partial  

## User Intention
User wanted to fix a critical onboarding UX issue where users lose their progress when restarting the app mid-onboarding (specifically after granting screen recording permission, which requires a macOS restart). The root cause needed investigation and fixing: authentication not persisting across restarts AND onboarding step not being restored.

## What We Accomplished
- ✅ **Local flag sync with database** - When user authenticates, local `onboarding.json` flag now syncs with DB `onboarding_done` state
- ✅ **Onboarding step persistence** - Current step saved to local file and restored on restart
- ⚠️ **Supabase session persistence** - Attempted electron-store implementation but hit race condition issues
- ✅ **Deep architecture investigation** - Documented entire onboarding+auth flow, quirks, and decision points

## Technical Implementation

### 1. Local Flag Sync (✅ Working)
**Problem:** User could reset DB `onboarding_done` to `false` for testing, but local flag stayed `true`, causing main window to open instead of onboarding window.

**Solution:** Added IPC handler `onboarding:reset-local-flag` that gets called when auth check detects `onboarding_done: false` in database.

**Files Modified:**
- `src/main.ts` - Added `onboarding:reset-local-flag` IPC handler
- `src/preload.ts` - Exposed `resetOnboardingFlag()` method
- `src/types/electron.d.ts` - TypeScript definitions
- `src/components/Onboarding.tsx` - Call reset in auth check (lines 642-650, 694-702)

### 2. Onboarding Step Persistence (✅ Working)
**Problem:** When user restarts mid-onboarding (e.g., on "permissions" step), app defaulted to "name-verification" step.

**Solution:** Save current step to `onboardingPrefs.currentStep` and restore on mount.

**Files Modified:**
- `src/main.ts` - Added `currentStep` field to onboardingPrefs, IPC handlers `onboarding:get-step` and `onboarding:set-step`
- `src/preload.ts` - Exposed step get/set methods
- `src/types/electron.d.ts` - TypeScript definitions
- `src/components/Onboarding.tsx` - Save on step change (useEffect), restore in auth check (lines 664-677)

### 3. Supabase Session Persistence (❌ Failed - Race Condition)
**Problem:** Supabase session not persisting across restarts due to Electron's unreliable localStorage with `file://` URLs in packaged builds.

**Attempted Solution:** 
- Created `src/lib/sessionStorage.ts` using electron-store
- Created `src/lib/sessionSync.ts` to listen to auth state changes
- Pre-inject session in `src/preload.ts` before Supabase initializes
- Added IPC handlers in `src/main.ts`

**Why It Failed:**
1. **Race condition:** Preload injection is async (non-blocking), Supabase initializes before session is injected
2. **File location mismatch:** Session being saved to wrong electron-store file initially (`session.json` vs `supabase-session.json`)
3. **No blocking mechanism:** No way to signal Supabase to wait for session ready

## Bugs & Issues Encountered

1. **Auth persistence already worked, not the problem**
   - **Symptom:** User thought session wasn't persisting, but it was in development
   - **Root cause:** Session persistence works fine in dev mode, breaks in packaged builds due to localStorage unreliability
   - **Fix:** Attempted electron-store solution (see above)

2. **Wrong file being modified initially**
   - **Symptom:** Made session persistence changes but didn't solve the actual problem (onboarding step not restoring)
   - **Root cause:** Misunderstood the problem - session WAS persisting during sign-in flow, but NOT across full app restarts
   - **Fix:** Pivoted to step persistence after deep investigation

3. **electron-store file naming confusion**
   - **Symptom:** Session data saved to `session.json` under nested key instead of dedicated `supabase-session.json`
   - **Root cause:** Multiple Store instances without proper schema, defaulting to same file
   - **Fix:** Added typed schema with proper defaults, but still didn't solve race condition

4. **Async preload injection race**
   - **Symptom:** Session file exists with data, but Supabase still reports no user on restart
   - **Root cause:** `(async () => {...})()` IIFE in preload doesn't block, Supabase initializes before injection completes
   - **Fix:** NOT FIXED - needs blocking mechanism or different approach

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
- This is why the flow works for returning users but breaks for mid-onboarding restarts

### Electron-Specific Gotchas
- **localStorage unreliable:** With `file://` URLs in packaged Electron apps, localStorage doesn't persist reliably
- **Preload async is non-blocking:** Async IIFE in preload continues execution, doesn't block renderer initialization
- **electron-store file sharing:** Multiple Store instances without unique names/schemas can collide
- **No simple injection point:** Can't easily inject data before Supabase initializes without blocking or signaling mechanism

### What We Got Wrong
1. **Session persistence was a red herring** for the immediate problem - step restoration was the real issue
2. **Tried to fix auth persistence** before confirming it was broken (it worked in dev, broke in production)
3. **Implemented complex solution** (electron-store sync) without addressing the synchronization timing problem

## Architecture Decisions

- **Dual persistence:** Step saved to both `onboardingPrefs.currentStep` AND session data approach (attempted)
- **Sync on auth:** Reset local flag whenever auth check runs and detects DB mismatch - keeps dev testing smooth
- **Step-specific storage:** Don't save "auth" or "complete" steps - cleaner state management
- **IPC for cross-process state:** Main process owns file storage, renderer coordinates via IPC

## Ready for Next Session

- ✅ **Onboarding step persistence** - Works correctly, ready to use
- ✅ **Local flag sync** - Prevents main window from opening when DB says onboarding incomplete
- 🔧 **Session persistence needs blocking** - Current async injection loses race to Supabase init
- 🔧 **Consider Supabase custom storage adapter** - Might be cleaner than localStorage injection approach
- 🔧 **Test in packaged build** - Dev mode localStorage works fine, need to verify packaged behavior

## Context for Future

This work solved the **step restoration** problem (user can now resume onboarding from correct step after restart), but **session persistence** across full app restarts in packaged builds remains unsolved due to timing issues. The async preload injection approach doesn't guarantee session is ready before Supabase initializes. Consider these alternatives:

1. **Supabase custom storage adapter:** Pass electron-store directly to Supabase instead of injecting into localStorage
2. **Synchronous session injection:** Find a way to block Supabase init until session ready (might require Supabase client creation delay)
3. **Accept localStorage unreliability:** Document that packaged builds require re-auth after restart (not ideal UX)

The onboarding architecture investigation revealed important quirks about the two-flag system and "let them in" behavior that should inform any future auth/onboarding changes. The dual-flag approach exists primarily to support dev testing (reset DB without clearing local files), but creates sync complexity.
