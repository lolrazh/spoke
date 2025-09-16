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

## Context for Future
Resolving the flicker will harden the onboarding experience across branches and releases. The investigation points to compositor behavior under certain CSS effects; the next set of tests should decisively confirm whether `backdrop-filter` is the remaining trigger so we can implement a minimal, design-aligned fix.


