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
