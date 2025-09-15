# Cinematic Intro Overlay & Dev Flags Hardening

**Date:** 2025-09-15  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
The user wanted a premium, cinematic first-run experience (visual intro with logo, grid, and particles) that avoids dumping users straight into sign-in. They also needed a frictionless way to iterate on the intro (replay during development) and a simple path to view the cinematic without the onboarding flow interfering.

## What We Accomplished
- ✅ **Cinematic intro overlay** - Implemented `IntroExperience` with grid background, particles, logo reveal, tagline, CTA, skip, reduced-motion support.
- ✅ **Mounted intro above onboarding** - Intro renders over `Onboarding` and dismisses on click/CTA/timeout.
- ✅ **Removed has-seen gating** - Eliminated localStorage check so intro shows every run for now.
- ✅ **Dev overrides** - Added intro-only mode and replay flags to reliably test the cinematic without auth/permissions.
- ✅ **Respect reduced motion** - Disables particles and heavy motion when `prefers-reduced-motion` is set.

## Technical Implementation
- Created `src/components/intro/IntroExperience.tsx` using Framer Motion for staged timeline and a canvas for particles. Grid is a CSS dotted grid with a radial mask.
- Wired into `Onboarding.tsx` as a full-viewport overlay with `showIntro` state.
- Added CSS classes in `src/index.css` for overlay, grid, particles, typography, and controls.
- Introduced dev flags exposure for `introOnly` and `replayIntro` via `src/preload.ts` so the renderer sees env state early.
- Updated dev scripts in `package.json` to pass flags (`VITE_INTRO_ONLY=1`, `VITE_REPLAY_INTRO=1`). Ultimately removed the has-seen flag for immediate reliability.

## Files Modified
- `src/components/intro/IntroExperience.tsx` - New component (overlay, particles, skip, CTA)
- `src/index.css` - Styles for intro overlay, grid, particles, CTA, skip
- `src/components/Onboarding.tsx` - Mount overlay, remove has-seen flag, add intro-only render path
- `package.json` - Dev scripts updated to set intro flags
- `src/preload.ts` - Expose `devFlags.introOnly`/`replayIntro` from env

## Bugs & Issues Encountered
1. **Intro skipped to permissions** - Onboarding’s auth/step effect advanced to permissions regardless of intro state; has-seen gating relied on localStorage plus env timing.
   - **Fix:** Removed the has-seen flag (intro always shows). Added intro-only short-circuit so the auth/step effect is skipped in cinematic-only viewing.
2. **Env visibility timing** - Vite envs are in renderer, but Electron process env needed bridging for early access.
   - **Workaround:** Mirrored intro flags in `preload.ts` under `window.devFlags` for immediate availability.

## Key Learnings
- **Guard onboarding effects** when overlays own first-run; otherwise they race and steal control.
- **Bridge dev flags via preload** to avoid renderer timing issues with envs.
- **Keep the cinematic self-contained** to simplify iteration and testing.

## Architecture Decisions
- **Always show intro (for now)** to accelerate design iteration until final gating is chosen.
- **Intro-only mode** to decouple cinematic testing from onboarding logic.
- **Canvas particles** for smoother performance and lower overdraw at modest counts.

## Ready for Next Session
- ✅ **Particle wander mode ready** - Switch from converge-only to continuous drift after reveal.
- ✅ **Hooks/timeline in place** - Easy to extend without changing external API.

## Context for Future
This establishes a premium first impression and a stable foundation to add audio, richer particle fields, and parallax. With reliable flags and no gating, iteration is fast and predictable.
