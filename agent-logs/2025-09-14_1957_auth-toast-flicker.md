# Auth Toast & Flicker Fix (Merged)

**Date:** 2025-09-14 19:57  
**Agent:** OpenAI Coding Agent (Codex CLI)  
**Status:** ✅ Completed  

## User Intention
The user wanted to stop the spurious “You’ve been signed in.” notification from appearing during Mission Control/Spaces transitions and eliminate the visual flicker of the pill when returning from those OS views. The deeper goal is a reliable, non-janky auth UX where the sign-in toast only shows when a user actually completes sign-in and the pill remains visually stable on focus/display changes.

## What We Accomplished
- ✅ **Moved sign-in toast to onboarding completion** – Toast is now emitted when onboarding actually completes (returning or new users), not on generic auth state changes.
- ✅ **Removed pill re-show on SIGNED_IN in App.tsx** – Stopped calling `showFloatingBar()` on `SIGNED_IN`, removing the fade that caused flicker on focus/Spaces.
- ✅ **Persisted auth signals across windows** – `authIntentTs`, `authCallbackTs`, `onboardingTs`, and `lastToastTs` are mirrored to `localStorage` so onboarding and pill renderer processes share timing context.
- ✅ **Kept tasteful renderer ownership** – Main stays focused on window mechanics; renderer orchestrates toasts and flow, consistent with 2025-09-13 auth-ux-polish.
- ✅ **Restored missing toast on deep-link path** – When the auth callback short‑circuits via `profile.onboarding_done`, we now emit the toast after `await onboardingComplete()` so the pill window is present. (Merged from 2025-09-14_1718_auth-notification-fix.md.)

## Technical Implementation
- `src/utils/authSignals.ts`
  - Added read/write of `authIntentTs`, `authIntentProvider`, `authCallbackTs`, `onboardingTs`, `lastToastTs` to `localStorage` with safe fallbacks.
  - `getSignals()` now reads through storage to reflect updates from other renderer windows.
- `src/components/App.tsx`
  - In Supabase `onAuthStateChange`, removed `showFloatingBar()` and the sign-in toast on `SIGNED_IN`.
  - Retain updating `lastToastTsRef`/`setLastToastTs` only to suppress any late duplicates.
- `src/components/Onboarding.tsx`
  - Emit “You’ve been signed in.” after `onboardingComplete()` for both returning-user short-circuit and the completion button flow.
  - Deep‑link callback path: when `profile.onboarding_done` is true, call `window.notifications.send("You've been signed in.")` immediately after awaiting `onboardingComplete()` to avoid lost toasts. (This was the follow‑up fix merged today.)

**Files Modified:**
- `src/utils/authSignals.ts` – Persisted signals to `localStorage`; added hydration helpers.
- `src/components/App.tsx` – Removed re-show and toast on `SIGNED_IN`; timestamp updates only.
- `src/components/Onboarding.tsx` – Send sign-in toast at real completion points (including deep‑link short‑circuit path).

## Bugs & Issues Encountered
1. **Flicker when returning from Mission Control/Spaces** – App re-showed the pill on `SIGNED_IN` events, which can occur around focus/display churn.
   - **Fix:** Do not call `showFloatingBar()` in App’s `SIGNED_IN` handler; let onboarding completion own reveal.
2. **Toast firing during focus churn** – `SIGNED_IN` could be observed without recent intent context in the pill window.
   - **Fix:** Centralized toast in onboarding completion and persisted auth signals across windows for accurate gating.
3. **Cross-window intent visibility** – In-memory timestamps weren’t visible to the pill renderer.
   - **Fix:** Mirror to `localStorage` and read-through in `getSignals()`.

## Key Learnings
- **Single-source UX events** – Emit the sign-in toast at the definitive completion point (onboarding), not on generic auth state changes.
- **Renderer separation matters** – Multiple renderer processes require explicit state sharing (e.g., `localStorage`) for timing-sensitive gates.
- **Avoid unnecessary window transitions** – Re-triggering fades on focus/display changes creates perceived jank.
- **Notify after window is ready** – Emitting the toast post‑`onboardingComplete()` guarantees the pill is visible to host the notification and prevents lost toasts on racey window transitions.

## Architecture Decisions
- **Toast ownership → Onboarding** – Keeps the user-facing message tied to explicit sign-in completion and prevents spurious toasts. Trade-off: onboarding emits the toast instead of the pill window, but improves correctness and polish.
- **Main focuses on mechanics** – Reinforces the separation where main handles window fade/position; renderer owns UX and notifications.

## Ready for Next Session
- ✅ **Stable sign-in toast and no flicker** – Current flow is consistent and polished.
- 🔧 **Optional hardening** – Add a guard in `smoothShow` to no-op when already visible at full opacity; unit tests for `shouldToastSignIn` edge cases.

## Context for Future
Builds on 2025-09-13_1416_auth-ux-polish.md by refining ownership and timing. Merged the additional fix from `2025-09-14_1718_auth-notification-fix.md` to ensure the deep‑link path also shows the toast. This reduces QA noise and sets a reliable baseline for future auth enhancements (e.g., JWT-gated WS, realtime logout) without regressing UX quality.
