# Onboarding Music and Speaker Toggle

**Date:** 2025-09-16  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
The user wanted onboarding to feel premium and intentional by adding subtle background music from the moment the app opens, with a tasteful, system-consistent speaker toggle to control it. As polish, they wanted smooth icon transitions, larger consistent sizing, and refined audio behavior (autoplay, graceful fades, and lifecycle alignment with onboarding steps).

## What We Accomplished
- ✅ **Autoplaying onboarding music** — Loads `/assets/onboarding-music.mp3`, loops, and starts on mount with graceful fallback if autoplay is blocked.
- ✅ **Speaker toggle control** — Top-right, ghost-style button matching the chevron design; fixed-size wrapper, crossfade between states, and larger visual size for clarity.
- ✅ **Custom mute icon** — Added `speaker.slash.fill` from a provided SVG to `sf-symbols.json`; used in toggle (no CSS hack overlay).
- ✅ **Smooth volume fades** — 600 ms fades on toggle; 800 ms fade when entering mic-check.
- ✅ **Lifecycle alignment** — Music fades out on entering mic-check and pauses; the speaker toggle is hidden from mic-check onward; onboarding completion closes immediately without extra delay.

## Technical Implementation
- Audio created via `new Audio('/assets/onboarding-music.mp3')` with `loop=true`. Autoplay attempt wrapped with fallback state.
- Volume fades implemented with `requestAnimationFrame` in `fadeVolumeTo(to, durationMs)`; used for toggle and step-based fade out.
- Icon stability achieved by rendering inside a fixed 28×28 wrapper and crossfading with `AnimatePresence` and `motion.div`.
- Custom icon pipeline uses `SfIcon` reading `public/assets/sf-symbols.json`; we added a new entry with accurate geometry.

**Files Modified:**
- `src/components/Onboarding.tsx` — Added audio lifecycle, toggle state, fade helper, mic-check fade, conditional toggle rendering, and icon crossfade.
- `public/assets/sf-symbols.json` — Added `speaker.slash.fill` entry using provided SVG geometry and path.
- `src/index.css` — Removed temporary mute slash overlay; retained chevron-style button classes.

## Bugs & Issues Encountered
1. **Autoplay blocked by browser/electron policy** — Music didn’t start on some runs.
   - **Fix:** Attempted autoplay and, on failure, set `musicEnabled=false` until user toggles.
2. **Linter error for inline `WebkitAppRegion`** — Type mismatch on style prop.
   - **Fix:** Switched to using the existing `no-drag` class; lints pass.
3. **Icon position “jump” due to geometry mismatch** — Width differences between speaker and slash.
   - **Fix:** Fixed-size wrapper (`w-7 h-7`) with crossfade; no layout shift.
4. **End fade not audible** — Fade happened after blocking calls.
   - **Fix:** Moved fade behavior to run when entering `mic-check` and removed end-of-onboarding delay.

## Key Learnings
- **UI stability**: Fixed-size icon wrappers + crossfade is a robust pattern for variant glyphs.
- **Audio UX**: Fading with `requestAnimationFrame` yields predictable results across Electron and avoids timing with blocking calls.
- **Asset pipeline**: A lightweight JSON-driven icon system (`SfIcon`) is flexible; adding custom paths is fast and avoids external lib styling mismatches.

## Architecture Decisions
- **Fade on mic-check entry, not at completion** — Ensures the user experiences the fade naturally during the flow and avoids timing races with window close.
- **Hide toggle after mic-check** — Reduces UI noise once music is out of scope and keeps attention on functional steps.
- **Custom icon via `sf-symbols.json`** — Keeps styling consistent with existing icons and avoids a second icon library.

## Ready for Next Session
- ✅ **Optional stepped volume waves** — If desired, add `speaker.wave.2.fill` and `speaker.wave.1.fill` to sequence wave steps before slash.
- 🔧 **Settings preference** — Consider a user setting to disable onboarding music globally for accessibility.

## Context for Future
This work improves the onboarding’s perceived quality and sets up a reusable pattern for subtle audio with robust lifecycle control. The icon pipeline and fade helper can be reused in other parts of the app for consistent, premium-feel transitions.

---

## Follow-up Fixes (Later on 2025-09-16)

### What We Refined
- ✅ **Instant toggle UI, async audio fade** — Icon updates immediately while audio fades in/out in the background.
- ✅ **Intro timing polish** — Speaker toggle now appears only after the intro content finishes, with a small buffered delay.
- ✅ **Softer entrance** — Toggle animates in with a smoother fade/scale and subtle blur for a premium feel.
- ✅ **Hover hit-area fix** — Resolved draggable header overlap and enlarged the hit target so hover/click work across the entire button.

### Technical Implementation
- UI state flips synchronously; audio fade runs in an async IIFE (no UI delay).
- Intro signals `onReadyForControls` at `stage >= 3` with an extra delay (`~650ms`, `120ms` when reduced motion) to trail the CTA finish.
- Entrance animation updated to include opacity/scale and CSS filter blur over ~0.5s.
- Drag region trimmed on the top-right (`right: 80px`) and button hit-area increased to avoid partial hover zones.

**Files Modified (follow-up):**
- `src/components/Onboarding.tsx` — Immediate `musicEnabled` flip; async fades; intro-controlled toggle reveal via `AnimatePresence`/`motion.button` with refined animation; `introControlsReady` state and reset on replay.
- `src/components/intro/IntroExperience.tsx` — Added optional `onReadyForControls`; fire after final stage with small delay (respects reduced motion).
- `src/index.css` — Added `.sf-intro-controls` above overlay; adjusted `.onboarding-header { right: 80px; }` to avoid drag overlap; increased `.pill-collapse-btn` size for better hit area.

### Bugs & Issues Encountered
1. **Toggle icon felt delayed** — UI waited on audio fade promise.
   - **Fix:** Flip UI first, run fade/play/pause asynchronously.
2. **Toggle appeared too early in intro** — Rendered immediately under overlay.
   - **Fix:** Gate rendering on `onReadyForControls` after intro final stage with buffer.
3. **Hover only worked on lower half** — Top draggable region intercepted pointer events.
   - **Fix:** Reduced header drag width on the right and enlarged button hit area.

### Impact
- More responsive feel, better cinematic sequencing, and reliable interactivity (hover/click) on the speaker toggle.
