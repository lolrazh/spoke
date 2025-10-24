# Floating Bar Toggle Persistence

**Date:** 2025-10-24  
**Agent:** Codex GPT-5  
**Status:** ✅ Completed  

## User Intention
User wanted the floating bar visibility toggle to behave consistently so that disabling it inside the settings panel actually hides the UI and keeps that preference synchronized with the main process, avoiding unexpected re-enabling when the panel is reopened.

## What We Accomplished
- ✅ **Restored deferred hide workflow** - Preserved the pending hide reminder through panel collapse so the main process receives the hide command after notifications finish.
- ✅ **Eliminated toggle-on flicker** - Skipped redundant `showFloatingBar()` when cancelling a deferred hide, keeping the expanded pill steady when users change their mind immediately.
- ✅ **Maintained notification UX** - Ensured the existing “floating bar hidden” toast still fires exactly once when collapsing from the expanded panel.
- ✅ **Regression check** - Re-ran `SettingsPanel.behavior.test.tsx` to confirm toggle wiring continues to fire the external handler.

## Technical Implementation
The toggle now tracks whether its notification should be deferred until after collapse, allowing the post-notification effect to make the actual `hideFloatingBarIndefinitely` call. This keeps renderer state and the main-process `floatingBarEnabled` flag in sync without duplicating notifications.

**Files Modified:**
- `src/components/App.tsx` - Added `deferNotification` state, updated collapse handler, and short-circuited `showFloatingBar()` when cancelling a deferred hide to prevent flicker.

## Bugs & Issues Encountered
1. **Pending hide cleared too early** - Collapsing the panel reset `pendingHideAfterCollapse`, preventing the hide effect from firing.
   - **Fix:** Retained the pending state until after the notification-run path completes, with a `deferNotification` marker for collapse-triggered hides.
2. **Immediate re-enable flicker** - Running `showFloatingBar()` after cancelling a deferred hide made the window briefly re-animate.
   - **Fix:** Recognized deferred-cancel scenarios and skipped the redundant show call so the bar stays steady.

## Key Learnings
- **State hand-off timing matters** - Deferring UI affordances across animation transitions requires keeping reminder state alive until the final effect runs.
- **Renderer/Main sync relies on single source of truth** - The main process flag remained authoritative, so renderer-side toggles must always propagate through to maintain UX consistency.
- **Deferred notifications need explicit markers** - Tracking whether a toast has already been emitted prevents double messaging when collapsing.

## Architecture Decisions
- **Defer hide via effect rather than collapse handler** - Let the notification completion effect continue owning the hide to avoid duplicating logic and keep sequencing centralized.
- **Use optional metadata on pending state** - Introduced `deferNotification` to distinguish collapse-triggered hides from immediate ones, minimizing new state atoms.

## Ready for Next Session
- ✅ **Floating bar toggle** - Now correctly persists user intent across collapses and tray interactions.
- 🔧 **Test warnings** - Vitest still surfaces Radix `act(...)` warnings; consider addressing when improving test ergonomics.

## Context for Future
The floating bar preference now stays in lockstep between renderer and main, clearing the path for any future work that relies on accurate visibility state (e.g., analytics, additional tray commands, or onboarding flows).
