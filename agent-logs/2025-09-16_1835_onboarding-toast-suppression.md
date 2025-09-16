# Onboarding Sign-in Toast Suppression

**Date:** 2025-09-16  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
The user wanted to prevent the “You’ve been signed in.” notification from appearing right after a first-time onboarding completes. The deeper goal is to keep onboarding feeling premium and quiet for new users while still allowing a tasteful sign-in confirmation for returning users who bypass onboarding.

## What We Accomplished
- ✅ **Removed post-onboarding sign-in toast for first-time users** – Eliminated the toast emitted at the end of the onboarding completion handler.
- ✅ **Kept toast for returning users who skip onboarding** – Deep-link/`onboarding_done` short-circuit still emits the toast once the pill is ready.
- ✅ **No regressions to auth gating** – Left renderer-owned auth state and `App.tsx` gating intact; no duplicate toasts.
- ✅ **Lints clean** – Verified no linter issues in the edited file.

## Technical Implementation
We limited changes to the renderer onboarding component and left main-process mechanics unchanged, consistent with prior auth UX architecture.

**Files Modified:**
- `src/components/Onboarding.tsx` – Removed `window.notifications?.send("You've been signed in.")` from `handleComplete` (first-time onboarding completion). Preserved the notification in the returning-user short-circuit path (`profile.onboarding_done`).

## Bugs & Issues Encountered
1. **Potential duplicate toast sources** – Historically, toasts also fired on generic `SIGNED_IN` events.
   - **Fix/Guard:** Confirmed prior work moved sign-in toast ownership out of `App.tsx`’s `SIGNED_IN` handler and into onboarding completion for correctness; our change further scopes it away from first-time completion only.

## Key Learnings
- **Context matters for toasts** – Emitting the toast at onboarding completion is correct for returning users, but noisy for first-time users.
- **Renderer ownership is clean** – Keeping notifications in the renderer allows precise gating without main-process coupling.

## Architecture Decisions
- **Suppress first-time onboarding toast** – Onboarding completion no longer emits a toast for brand-new users.
- **Retain returning-user toast** – When `onboarding_done` is already true, we continue to show a confirmation after `onboardingComplete()` so users get feedback on successful sign-in without re-running onboarding.

## Ready for Next Session
- ✅ Baseline is stable; onboarding finishes quietly for first-time users.
- 🔧 Optional: Add a small unit test for the returning-user short-circuit path or add telemetry around toast frequency to ensure no unintended duplicates.

## Context for Future
This refines the premium feel of onboarding and reduces early-session noise, while maintaining a clear confirmation for returning users. It complements previous work on auth-toast gating and flicker reduction documented in `2025-09-14_1957_auth-toast-flicker.md` and the onboarding hardening on `2025-09-16`.


