# Onboarding Restart Persistence & Screen Recording Reordering

**Date:** 2025-12-13
**Agent:** Claude Sonnet 4.5
**Status:** ❌ Failed

## User Intention
User wanted to solve the mid-onboarding restart UX problem where screen recording permission (which requires an app restart to take effect on macOS) was causing users to lose their onboarding progress. When users quit and reopened the app after granting screen recording, they would be forced to sign in again and start onboarding from scratch. Additionally, user wanted screen recording permission moved to the last position (4th) in the permissions list instead of 2nd.

## What We Accomplished
- ✅ **Screen Recording Repositioned** - Moved from 2nd to 4th position in both Onboarding.tsx and PermissionsPanel.tsx
- ✅ **Permission Order Updated** - New order: Microphone → Accessibility → Input Monitoring → Screen Recording
- ❌ **Session Persistence Failed** - Attempted multiple approaches to preserve Supabase session and onboarding step across restarts, but user still required to sign in again

## Technical Implementation

**Attempted Approach #1: Step Persistence via Local File**
- Added `currentStep` field to `onboardingPrefs` object in main.ts
- Created IPC handlers `onboarding:set-step` and `onboarding:get-step`
- Modified Onboarding.tsx to save current step on every state change
- Modified Onboarding.tsx to restore saved step on mount

**Attempted Approach #2: Electron Partition Configuration**
- Added `partition: "persist:main"` to both main window and onboarding window webPreferences
- Attempted to ensure both windows share the same localStorage storage
- Added debug logging to check for Supabase session keys in localStorage

**Attempted Approach #3: Session Hydration Timing**
- Added explicit `getSession()` call before checking auth status
- Attempted to ensure Supabase client had time to load session from localStorage
- Added debug logging to trace session loading

**Files Modified (all reverted):**
- `src/main.ts` - Added currentStep to onboardingPrefs, partition config, IPC handlers
- `src/preload.ts` - Added setOnboardingStep/getOnboardingStep methods
- `src/types/electron.d.ts` - Added TypeScript types for step persistence methods
- `src/components/Onboarding.tsx` - Reordered permissions, added step persistence logic, session debug logging
- `src/components/PermissionsPanel.tsx` - Reordered permissions to match onboarding

## Bugs & Issues Encountered

1. **Supabase Session Loss on App Restart** ❌ **UNRESOLVED**
   - **Symptom:** When user quits and reopens app mid-onboarding, Supabase session is not found, requiring re-authentication
   - **Root Cause:** Unknown - localStorage keys may not be persisting across Electron app restarts
   - **Attempted Fixes:**
     - Added explicit partition configuration
     - Added session hydration wait logic
     - None of the fixes resolved the issue
   - **Status:** User reverted all changes due to continued failure

2. **Step Restoration Timing Race Condition**
   - **Symptom:** Two separate useEffects racing - one restoring step, one checking auth
   - **Attempted Fix:** Merged into single coordinated flow that checks saved step first, then auth status
   - **Status:** Not tested due to session persistence failure blocking progress

3. **Permission Order Mismatch**
   - **Symptom:** Screen recording was 2nd in UI but should be last (requires restart unlike others)
   - **Fix:** Successfully reordered to: Mic → Accessibility → Input Monitoring → Screen Recording
   - **Status:** ✅ This part worked but was reverted along with everything else

## Key Learnings

- **Electron localStorage Persistence:** Simply setting `persistSession: true` in Supabase config is not sufficient in Electron. The localStorage data may not persist across app restarts without additional configuration.

- **Partition Configuration Complexity:** Adding `partition: "persist:main"` to webPreferences should ensure localStorage persists, but this alone didn't solve the session loss issue. The root cause may be deeper in Electron's session management.

- **macOS Screen Recording Restart Requirement:** Screen recording is unique among the 4 permissions - it's the ONLY one that requires a full app restart to take effect. Others (mic, accessibility, input monitoring) work immediately after grant.

- **Supabase Session Storage in Electron:** The Supabase JS client stores sessions in localStorage with keys like `sb-{project-ref}-auth-token`. In Electron, this storage may be cleared or isolated depending on window configuration.

- **Two Separate Problems:** Session persistence and onboarding step persistence are orthogonal issues:
  1. Session persistence = Supabase auth state in localStorage
  2. Step persistence = Current onboarding step in local file
  Both must work for seamless mid-onboarding restarts.

## Architecture Decisions

- **Screen Recording Last:** Decided to make screen recording the final permission in the flow since it's the only one requiring restart. This minimizes UX disruption (users grant 3 permissions that work immediately, then restart at the end).

- **Local File for Step State:** Chose `onboarding.json` file persistence over database calls or localStorage for step tracking to avoid network dependency and separate concerns from auth state.

- **Unified Auth Flow:** Attempted to merge separate step-restoration and auth-check useEffects into single coordinated flow to eliminate race conditions.

## Ready for Next Session

- 🔧 **Root Cause Investigation Needed** - Session loss on restart must be debugged with actual localStorage inspection in Electron DevTools
- 🔧 **Alternative Approaches to Consider:**
  1. Store session refresh token in Electron's secure storage instead of localStorage
  2. Use Electron's session.defaultSession.cookies to persist auth state
  3. Investigate whether windows need explicit session sharing config
  4. Consider whether onboarding window should be a child window of main window to share context
- 🔧 **Screen Recording Permission Strategy** - Reconsider whether screen recording should be:
  1. In onboarding (current approach - causes restart issue)
  2. Post-onboarding in Settings (avoids restart during onboarding)
  3. Optional vs required (currently required, could be optional enhancement feature)

## Context for Future

This work attempted to solve a critical UX issue where the macOS screen recording permission requirement (full app restart to take effect) disrupts the onboarding flow. The fundamental problem remains unsolved: Supabase sessions are not persisting across Electron app restarts. Future sessions should focus on understanding Electron's localStorage behavior, potentially using DevTools to inspect what's actually stored and whether it survives restart. Consider whether making screen recording optional or post-onboarding would provide better UX than solving the persistence issue. The session loss may also indicate a broader architecture problem with how Electron windows are configured in this app.

**Critical Unresolved Question:** Why does localStorage (where Supabase stores sessions) not persist across Electron app restarts even with `partition: "persist:main"` configured? This is fundamental to any onboarding restart flow.

---

## Session 2: Custom Storage Adapter Attempt

**Date:** 2025-12-13 18:00
**Agent:** Claude Opus 4.5 (Antigravity)
**Status:** ❌ Failed - Window didn't open, only music played

### Root Cause Identified

Web search revealed that **Electron's localStorage is unreliable in packaged apps with `file://` URLs**. This is a known Chromium/Electron limitation:
- Works in development, fails in production
- Not guaranteed to persist across app restarts in packaged builds

### What We Attempted

**Approach: Custom Supabase Storage Adapter using electron-store**

Created a custom storage adapter that routes Supabase's session storage through IPC to main process, using `electron-store` (file-based JSON) instead of unreliable localStorage:

1. **`src/lib/sessionStorage.ts`** (NEW) - electron-store based session storage
2. **`src/main.ts`** - Added IPC handlers for `session:get`/`session:set`/`session:remove`
3. **`src/preload.ts`** - Exposed `window.sessionStorage` bridge to renderer
4. **`src/types/electron.d.ts`** - Added TypeScript types
5. **`src/lib/supabaseClient.ts`** - Added async custom storage adapter:

```typescript
const electronStorageAdapter = {
  getItem: async (key: string) => window.sessionStorage.getItem(key),
  setItem: async (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: async (key: string) => window.sessionStorage.removeItem(key),
};

// Passed to Supabase:
storage: electronStorageAdapter,
```

### Why It Failed

**Symptom:** App launches, music plays, but onboarding window never appears.

**Likely Cause:** The async storage adapter may have caused a race condition or blocking issue during Supabase initialization. Supabase calls `getItem()` synchronously during `createClient()`, but our adapter was async (returning Promises). Even though Supabase docs say async is supported, something in the initialization flow may have hung waiting for the IPC round-trip.

### Files Modified (all reverted by user)
- `src/lib/sessionStorage.ts` (deleted)
- `src/lib/supabaseClient.ts`
- `src/main.ts`
- `src/preload.ts`
- `src/types/electron.d.ts`

### Key Learning

**Supabase's `storage` adapter may not work well with async IPC in Electron.** The initialization path appears to be sensitive to blocking/async behavior. Need to either:
1. Use synchronous storage in the renderer (not possible with IPC)
2. Pre-load session token before Supabase client initialization
3. Find a different approach entirely

### Alternative Approaches to Consider

1. **Pre-warm session from main process** - Read session from electron-store in main, pass to renderer via preload, inject into Supabase manually
2. **Synchronous file read in renderer** - If Node integration is enabled, read session file synchronously (security concern)
3. **Skip screen recording during onboarding** - Make it post-onboarding optional feature (avoid restart problem entirely)
4. **Two-phase onboarding** - Complete onboarding first, then prompt for screen recording as a "power user" optional step after main app is running