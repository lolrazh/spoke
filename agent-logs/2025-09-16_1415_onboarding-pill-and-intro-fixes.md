# Onboarding Pill Reveal + Intro Overlay Integration

**Date:** 2025-09-16  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
The user wanted to add a cinematic intro step to onboarding without regressing the hotkey test pages where the pill should appear compact for dictation testing. The goal was to preserve the existing pill behavior (no Settings opening) and avoid flicker between pages, while keeping dev ergonomics for iterating on the intro.

## What We Accomplished
- ✅ **Restored pill appearance on onboarding test pages** — Fixed onboarding to show the compact pill reliably on the hotkey test steps.
- ✅ **Eliminated Settings panel popping open** — Replaced expand calls with a compact reveal so the pill does not open `SettingsPanel` during tests.
- ✅ **Removed onboarding flicker** — Made reveal/expand idempotent and suppressed DevTools during onboarding prepare to avoid show/hide races.
- ✅ **Integrated cinematic intro overlay safely** — Intro now overlays onboarding with a clean exit and doesn’t interfere with step logic.

## Technical Implementation
- Onboarding hotkey steps now set `pttTarget = "onboarding"` and call `revealPill()` (compact) instead of expanding.
- Added `pill:reveal` IPC in main to top‑align and show the pill without sending `expand-pill`.
- Hardened `pill:reveal` and `pill:expand` to be idempotent: adjust bounds only if Y changed; run `smoothShow()` only when window is hidden.
- Gated pill auto-show and DevTools so the pill doesn’t pop/flash when preparing during onboarding.
- Intro overlay (`IntroExperience`) exits using `AnimatePresence onExitComplete`, matching onboarding page motion and preventing premature unmount.

## Files Modified:
- `src/components/Onboarding.tsx` — Use `revealPill()` on test steps; mount intro overlay; guard auth step when `introOnly`.
- `src/main.ts` — Add `pill:reveal`; make `pill:reveal`/`pill:expand` idempotent; gate renderer‑ready auto‑show by `pttTarget === "main"`; suppress DevTools during onboarding prepare.
- `src/preload.ts` — Expose `revealPill()` bridge.
- `src/types/electron.d.ts` — Typings for `revealPill()`.
- `src/components/intro/IntroExperience.tsx` — Exit sequencing via `onExitComplete` and page-consistent motion.

## Bugs & Issues Encountered
1. **Pill did not appear on test page** — Onboarding registered a listener (`expandPill`) instead of requesting an expand; no event was fired.
   - **Fix:** Call the IPC request (`pill:expand` initially, then replaced with compact `revealPill`).
2. **Massive flicker on navigation** — `prepare-pill` created the pill window; main auto‑showed it on `renderer-ready`, then `prepare` re‑hid it; DevTools opened at the same time.
   - **Fix:** Gate auto‑show by `pttTarget !== "main"` (skip during onboarding); suppress DevTools for pill during prepare; make reveal/expand idempotent.
3. **Settings panel opening during tests** — Using expand path sends `expand-pill`, and `App.tsx` expands to `SettingsPanel` by design.
   - **Fix:** Added `pill:reveal` (compact) and updated onboarding to call it on both hotkey test pages.

## Key Learnings
- **Event vs request paths matter** — Listener registration (`expandPill`) is not the same as requesting an action (`pill:expand`) in multi‑window Electron.
- **Main‑process gates prevent UI races** — Tying auto‑show and DevTools to `pttTarget` avoids conflicts between onboarding and pill lifecycles.
- **Idempotent window ops reduce flicker** — Only moving/animating when state changes eliminates visual churn on step transitions.

## Architecture Decisions
- **Compact reveal for onboarding tests** — Keep the test steps focused on dictation; reserve expansion (`SettingsPanel`) for explicit user actions.
- **pttTarget routing** — Continue to route Fn key events by target (`onboarding` vs `main`) to keep test pages deterministic.
- **Intro overlay as a self‑contained layer** — Isolate intro visuals and sequence exit via `onExitComplete` to keep onboarding logic stable.

## Ready for Next Session
- ✅ Onboarding pill tests are stable (compact, no flicker).
- 🔧 Optional: add a small crossfade overlap between intro exit and onboarding enter for even smoother handoff.

## Context for Future
This preserves the existing pill UX while enabling a premium intro step. The prep/reveal flow is now robust against window races, making future onboarding iterations (permissions, VAD demos, parallax intros) much safer.
