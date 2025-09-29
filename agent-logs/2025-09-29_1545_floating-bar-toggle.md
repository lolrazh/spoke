# Floating Bar Preference Stabilization

**Date:** 2025-09-29  
**Agent:** GPT-5 Codex  
**Status:** ✅ Completed  

## User Intention
The user wanted the privacy toggle and floating bar controls in the pill settings to behave predictably during normal sign-in flows. Beyond the immediate UI frustration, they wanted the floating bar to stay enabled by default after logging in instead of flipping off due to hidden state conflicts between the renderer and main process.

## What We Accomplished
- ✅ **Revalidated share preference toggle** - Confirmed the settings switch is only disabled while Supabase loads or updates, keeping it interactive for signed-in users.
- ✅ **Removed erroneous hide-on-startup call** - Stopped the renderer from persisting `floatingBarEnabled=false` whenever the app booted without an authenticated user.
- ✅ **Re-enabled preference on sign-in** - Explicitly call `showFloatingBar()` after hydrating a session so the main-process flag matches the visible state.

## Technical Implementation
- Investigated the preference flow between renderer state and the `floatingBarEnabled` flag in `main.ts` to diagnose why the toggle defaulted to off.
- Deleted the cold-start `hideFloatingBarIndefinitely()` invocation in `App.tsx`, preventing main from storing an off state before login completes.
- Added a guarded `showFloatingBar()` call when a user session hydrates, keeping both the window and stored preference in sync after authentication.

**Files Modified:**
- `src/components/App.tsx` - Removed the unsigned-in hide call and added a post-auth `showFloatingBar()` to persist the enabled preference.

## Bugs & Issues Encountered
1. **Toggle defaulting to off after login** - `App.tsx` called `hideFloatingBarIndefinitely()` during unsigned startup, persisting `floatingBarEnabled=false` even after sign-in.
   - **Fix:** Removed the call and re-enabled the preference with `showFloatingBar()` once a session loads.
2. **Share toggle confusion about loading state** - User believed the switch was still greyed out; verified the only remaining guards are intentional loading/updating flags and documented the behavior.
   - **Resolution:** No code change needed; clarified expected UX.

## Key Learnings
- **Renderer-side guards can unintentionally set persisted flags** - Even a protective hide call during onboarding can corrupt main-process preferences if not reversed.
- **Explicit re-sync keeps UI honest** - Calling the corresponding `show` API after auth avoids mismatch between visible UI and stored intent.
- **Loading shields should be minimal** - Restricting the share toggle disablement to actual async operations keeps the control responsive.

## Architecture Decisions
- **Trust main process for preference state** - Maintain a single source of truth (`floatingBarEnabled`) and update it deliberately rather than mirroring local state.
- **Post-auth reconciliation over speculative hides** - Prefer enabling after successful sign-in instead of pre-emptively hiding when unauthenticated.

## Ready for Next Session
- ✅ **Floating bar preference synced** - Users stay in a consistent “on by default” state after logging in.
- 🔧 **Optional: audit other onboarding hides** - Future work could review other onboarding flows to ensure they don’t leave persistent flags in inconsistent states.

## Context for Future
Today’s fixes ensure the floating bar’s preference mirrors what users see after authentication, reducing confusion. Future sessions can build on this by adding analytics or settings persistence confident that the bar’s state no longer drifts between main and renderer.


