# Onboarding Flicker Investigation

**Date:** 2025-09-16  
**Agent:** GPT-5 (Cursor)  
**Status:** 🔄 Ongoing  

## User Intention
Investigate and eliminate a consistent visual flicker that appears shortly after the onboarding/login window opens. The underlying goal is to ensure the onboarding experience feels stable and premium on every launch, regardless of auth state or branch. We need to narrow down root cause signals by comparing main vs feature branch behavior and make surgical changes that remove the flicker without regressing design or functionality.

## What We Accomplished
- ✅ **Narrowed likely cause to compositor events** – Identified macOS/Chromium compositing transitions (mask, backdrop-filter, full-screen canvas) as probable trigger.
- ✅ **Scoped window show pipeline** – Confirmed renderer-ready fade-in remains consistent and not the direct cause.
- ⚠️ **Attempted mitigation: neutralized intro grid mask** – Disabled `.sf-intro-grid.hole-active` mask to avoid GPU layer reshuffle ~1.2s after open. Flicker persists.
- ⚠️ **Attempted mitigation: delayed particles** – Deferred `ParticlesCanvas` mount by ~2s in `Onboarding.tsx` and `IntroExperience.tsx` to reduce early compositing stress. Flicker persists.
- ⚠️ **Diagnostic: compositor pre‑warm** – Injected hidden blur pre‑warm; later widened/opacity‑tweaked to ensure it exercises the pipeline. No change.
- ⚠️ **Diagnostic: disable onboarding backdrop‑filters** – Scoped override removing `backdrop-filter` within onboarding. No change.
- ⚠️ **Diagnostic: freeze animations/transitions** – Temporarily disabled transitions/animations in onboarding during first 4s to see if flicker correlates with CSS motion. Pending verification.

## Technical Implementation
Focused on minimizing early compositor churn while keeping UX intact:

**Files Modified:**
- `src/index.css` – Neutralized intro grid mask by setting `-webkit-mask-image`/`mask-image` to none for `.sf-intro-grid.hole-active`.
- `src/components/Onboarding.tsx` – Added `showParticles` state to mount `ParticlesCanvas` after ~2s.
- `src/components/intro/IntroExperience.tsx` – Added delayed particles in intro overlay; left stage timings intact.

## Bugs & Issues Encountered
1. **Flicker still occurs** – Despite neutralizing the mask and delaying particles, a flash persists shortly after window open.
   - **Hypothesis:** Remaining `backdrop-filter` usage on onboarding surfaces (cards/buttons) triggers the first compositor re-path once those elements render or animate, matching the timing observed on main (≈3s) and this branch (≈1–2s previously).  
   - **Status:** Unresolved; needs deeper isolation.

## Key Learnings
- **CSS masks + full-screen canvas can provoke compositor flips**; removing the mask did not fully remove the flicker, indicating additional triggers remain.
- **`backdrop-filter` is a usual suspect** for one-time layer reshuffles on macOS/Chromium when it first engages on larger containers.
- **Window show sequencing is sound**; no 2–4s timers in window show path. Timed effects in UI likely drive the visible flash.

## Architecture Decisions
- **Surgical mitigations first** – Avoid broad style regressions. Target specific high-risk effects (mask, particles timing) before altering design tokens or removing blur.
- **Parity with main** – The shared symptom on main suggests a platform compositor quirk; plan fixes that benefit both branches.

## Ready for Next Session
- ✅ Repro remains reliable; edits are small and reversible.
- 🔧 Next steps to test quickly:
  - Capture a Performance trace with “Screenshots” and “Layers” in DevTools at launch; mark the flicker moment to inspect layer tree diff.
  - Log every window `setBounds`/`invalidateShadow` call in `src/main.ts` during onboarding and guard against redundant Y moves at T+1–4s.
  - Disable `mix-blend-mode: overlay` on the grid temporarily; A/B if it’s causing a compositor re-path when first visible.
  - If confirmed, reintroduce blur selectively (localized overlays only) or replace with tokenized gradients/solid surfaces.
  - Capture a short screen recording with devtools performance panel to confirm a compositing change around the flicker timestamp.

---

# Continuation — Deeper Analysis and Proposed Surgical Fixes

**Date:** 2025-09-16 (later)
**Agent:** GPT-5 (Cursor)
**Status:** 🔄 In Progress

## What Happens in the First ~2 Seconds
- Renderer waits for fonts, then sends `renderer-ready`; main reveals onboarding via `smoothShow` (opacity 0→1 over ~140ms); CSS runs `fadeInOnboarding` on `.onboarding-window`.
- Immediately on mount, onboarding runs permission checks (helper spawn), adds resize listeners, and applies a `translateZ(0)` nudge to `.onboarding-window`.
- Several components still use `backdrop-filter` (cards/rows/buttons), though many surfaces are now solid tokens.

## Updated Hypothesis (High Confidence)
- The single, reliable flash at ~1–2s is a compositor re-path on macOS/Chromium triggered by:
  1) Container-level composition hints on a large element: `.onboarding-window { will-change: transform; contain: layout style paint; }` plus initial animation.
  2) First engagement of filtered surfaces (`backdrop-filter`) on non‑trivial regions after initial paint.

This aligns with the timing (no main-process timers in that window; prior attempts removing masks/particles didn’t remove the flash).

## Minimal, Reversible Fix Plan
1) Remove container isolation/promotion from `.onboarding-window` (drop `contain` and `will-change`).
2) Temporarily disable backdrop filters for the first 3s after mount via a top-level `.onboarding-no-filters` class applied on `<body>` (or onboarding root), then remove it; scope overrides to `.onboarding-card`, `.onboarding-row`, `.btn-secondary`, `.onboarding-close`, and any remaining filtered controls.
3) If (2) proves causal, keep blur only on small, localized overlays (dropdowns/popovers) which already use isolated pseudo-elements.

## Files to Change
- `src/index.css`: Remove `contain`/`will-change` on `.onboarding-window`; add `.onboarding-no-filters` overrides that set `backdrop-filter: none !important; -webkit-backdrop-filter: none !important;` for onboarding surfaces.
- `src/components/Onboarding.tsx`: On mount, add `.onboarding-no-filters` to `document.body` (or root) and remove it after 3000 ms. No behavioral changes otherwise.

## Expected Outcome
- The one-time compositor flip should be eliminated (or substantially reduced). If only (1) is applied and flicker disappears, we can skip (2). If needed, (2) is a guarded, first‑seconds mitigation and keeps permanent UI unchanged.

## Verification
- A/B with and without (1); if needed, A/B (2) at 3s window. Capture a DevTools performance trace (Screenshots + Layers) to confirm layer tree stability around T+1–2s.

## Rollback Plan
- Both changes are scoped and reversible; toggling the CSS and the 3s class removal returns to prior behavior instantly.

## Context for Future
Resolving the flicker will harden the onboarding experience across branches and releases. The investigation points to compositor behavior under certain CSS effects; the next set of tests should decisively confirm whether `backdrop-filter` is the remaining trigger so we can implement a minimal, design-aligned fix.



---

# Continuation — Flicker Persists; Next Isolation Steps

**Date:** 2025-09-16 (later)
**Agent:** GPT-5 (Cursor)
**Status:** 🔄 In Progress

## Result
- Flicker still occurs after:
  - Removing container `contain`/`will-change` from `.onboarding-window`.
  - Applying a 3s `.onboarding-no-filters` guard to disable `backdrop-filter` on onboarding surfaces.

## Interpretation
- The compositor re-path is likely being provoked by another first-seconds event unrelated to those two changes. Two candidates remain:
  1) The resize listeners toggling `.onboarding-window.resizing` (which changes `backdrop-filter` and transitions) around early layout passes.
  2) The explicit `translateZ(0)`/promotion applied to `.onboarding-window` via JS (late promotion after initial animations).

## Next Fixes (Surgical)
1) Remove the onboarding resize listeners and `.resizing` toggles entirely.
2) Remove the JS `translateZ(0)` nudge applied to `.onboarding-window` after DOMContentLoaded.

## Files Modified Next
- `src/components/Onboarding.tsx`:
  - Delete the resize handlers and event listeners that add/remove the `.resizing` class.
  - Remove the `onboardingWindow.style.transform = "translateZ(0)";` line in the DOM ready handler.

## Expected Outcome
- Eliminates any early-style toggles and late container promotions that could retrigger a compositor re-path at ~1–2s.

## If Flicker Still Persists
- Capture DevTools Performance trace with Layers at the flicker timestamp to identify the exact layer tree change.
- As a fallback, convert remaining blur usage in onboarding from direct `backdrop-filter` to localized isolated pseudo-elements (like `dropdown-glass::before` pattern) or swap to tokenized opaque surfaces.

---

# Continuation — Root Cause Confirmed and Fix Applied

**Date:** 2025-09-16 (later)
**Agent:** GPT-5 (Cursor)
**Status:** ✅ Resolved

## Root Cause
- Not a compositor-only issue. The pill was being shown ~2.5s into onboarding and running its “Signed out” notification. This was due to:
  - Cold-start auth flow treating initial “no session” like a sign-out, triggering the sign-out toast and the hide/show sequence.
  - `pill:reveal` allowed the pill to appear even while `pttTarget` was still `onboarding`.

## Fixes Implemented
- Renderer (`App.tsx`):
  - Guard sign-out handling so it only fires when transitioning from a previous user (ignore cold start with no prior user). Same guard added to the periodic auth polling path.
- Main (`main.ts`):
  - In `pill:reveal`, if `pttTarget === "onboarding"`, keep the pill hidden (force Y to `ISLAND_HIDDEN_Y`) and do not show the window.
  - In `prepare-pill`, set `pttTarget = "onboarding"` immediately so the guard is active during onboarding prep.

## Result
- The 2.5s flicker is gone; onboarding no longer shows the pill or signed‑out animation during cold start. The flow is stable and premium.

## Follow-up Bug (Tracked)
- On the hotkey test page, the pill must appear for dictation testing. Next: allow a safe reveal only on those steps (compact mode, no expansion), while keeping the onboarding guard for all other steps.
