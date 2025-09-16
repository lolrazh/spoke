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

---

# Continuation — Cinematic Intro Polish and Design System Alignment

**Date:** 2025-09-15 (later)  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed

## User Intention
Refine the first-run cinematic to feel premium and intentional: continuous starfield, square grid motif without visual hotspots, deliberate reveal timing, unified dark surfaces, smooth intro→onboarding transition, and strict adherence to the design system (copy, spacing, buttons).

## What We Accomplished
- ✅ **Continuous starfield** — Replaced converge-and-bounce with radial inward motion + gentle swirl, respawn at perimeter for infinite flow; dim near center to avoid hotspots.
- ✅ **Square dot grid + staged hole** — Switched to true square grid; no mask initially (prevent bald patch), enable soft hole only after logo stage.
- ✅ **Slower motion, minimal waiting** — Earlier stage triggers (0.6s/1.2s/1.8s) with longer durations for a calm feel without delays.
- ✅ **Copy and spacing in system** — Headline/subcopy types and spacing match onboarding (`text-heading-xl`, `text-subtle`, `space-y-2`).
- ✅ **CTA matches system** — Switched to `Button` with `btn-primary shimmer`; background/border tuned to block particles and respect tokens.
- ✅ **Unified dark surfaces** — `--surface-solid` and `--surface-base-rgb` set to rgb(10,10,10) for intro, pill, and onboarding consistency.
- ✅ **Smoother transition** — Onboarding window fade/scale-in uses app easing/timing; intro exit hands off cleanly.
- ✅ **Flags cleanup** — Removed reliance on `VITE_REPLAY_INTRO`/`VITE_INTRO_ONLY`; intro gating now lives inside onboarding logic.

## Technical Implementation
- `IntroExperience` starfield now uses polar params with center drift and local alpha falloff; trails shortened and swirl reduced.
- Grid is a single-layer radial-dot square pattern; applies `.hole-active` mask at stage ≥ 2.
- Reveal timeline adjusted; logo blur→crisp with micro scale-in; headline/subcopy animation uses standard ease.
- CTA uses `btn-primary` (design tokens) rather than custom gray; shimmer retained for polish.
- Global surface tokens darkened to 10,10,10; onboarding fade-in eased to feel consistent.

**Files Modified:**
- `src/components/intro/IntroExperience.tsx` — Starfield motion, staged grid hole, reveal timings, copy, CTA uses `btn-primary`, removed Skip.
- `src/index.css` — Square grid + staged mask, CTA styles (`btn-primary`, `.onboarding-cta` tuning), unified surface tokens to 10,10,10, onboarding fade/scale animation.
- `src/components/Onboarding.tsx` — Mount intro overlay; intro-only handling consolidated; no env flags required.

## Bugs & Issues Encountered
1. **Bald grid patch before logo** — Mask exposed too early.
   - **Fix:** Start with no mask; enable `.hole-active` when logo is visible (stage ≥ 2).
2. **Blackhole hotspot** — Particles over-concentrated at one point.
   - **Fix:** Add slow center drift and dimming near center; reduce swirl/trails.
3. **CTA readability over particles** — Stars bled through.
   - **Fix:** Use `btn-primary` token styles and isolation; stronger background/border.
4. **Jagged intro→onboarding** — Handoff felt abrupt.
   - **Fix:** Standardized onboarding fade/scale-in timing/ease; clean dismissal from intro.

## Key Learnings
- Stage timing should balance “no wait” with “slow motion”; trigger early, animate longer.
- Visual masks should be staged to avoid layout flashes during early frames.
- Keep CTAs on tokenized components to avoid style drift across surfaces.

## Architecture Decisions
- Use token-driven surfaces (10,10,10) for intro and onboarding to harmonize with the cinematic; can scope later if broader UI prefers 20,20,20.
- Prefer `Button` variants for primary actions; avoid ad‑hoc inline styles.

## Ready for Next Session
- ✅ Starfield and reveal are modular for further tweaks (density, speed, parallax).
- 🔧 Optional: add crossfade overlap between intro exit and onboarding enter (e.g., 120ms) if more continuity is desired.

## Context for Future
This polish brings the cinematic in line with the product’s design language and sets a stable baseline for adding sonic branding, parallax, and accessible variants without visual regressions.

---

# Continuation — Intro→Onboarding Transition Parity and Exit Sequencing

**Date:** 2025-09-16  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed

## User Intention
Make the transition from the cinematic intro to the onboarding page feel identical to other page transitions (content rises and fades out while the incoming content moves up from below), and ensure edits actually take effect.

## Root Cause
- The intro overlay invoked its `onFinish` callback immediately on CTA click while also starting a Framer Motion exit. The parent unmounted the intro overlay instantly, preventing the exit animation from playing. This made timing and easing tweaks appear to “do nothing.”
- The overlay was using a simple fade without the standard y-offset spring used elsewhere, so even when it did animate it didn’t match the onboarding step transitions.

## What We Changed
- Deferred parent notification until after the exit completes by moving the callback to `AnimatePresence` `onExitComplete`.
- Matched the onboarding page motion: `initial {opacity:0, y:16} → animate {opacity:1, y:0} → exit {opacity:0, y:-16}` with the same spring `{stiffness:340, damping:28, mass:0.45}`.

## Files Modified
- `src/components/intro/IntroExperience.tsx`
  - Wrap overlay in `AnimatePresence onExitComplete={onFinish}` and remove direct `onFinish()` from the click handler.
  - Apply page-consistent motion: `initial/animate/exit` with shared spring.

## Verification
- Onboarding container still fades/scales in via CSS `fadeInOnboarding` while the intro exits using the page spring. The handoff now mirrors other step transitions and feels consistent.
- ESLint reports no issues.

## Follow-ups (Optional)
- Add a slight overlap crossfade (≈120 ms) by rendering onboarding underneath the intro and staggering `mode="wait"`/callbacks for even more continuity.
