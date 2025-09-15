# PTT Gesture Guards: start-cue duplication + single‑tap hands‑free

**Date:** 2025-09-15  
**Agent:** OpenAI Codex CLI  
**Status:** ✅ Completed  

## User Intention
Ensure dictation start/stop gestures feel correct and consistent: no double start sound on first use/after idle, and never start hands‑free dictation from a single tap. Preserve intended semantics (hold-to-speak and double-tap to toggle) without latency or race artifacts.

## What We Accomplished
- ✅ Start cue dedupe – Added a per‑gesture guard so the start sound plays at most once even if both long‑press and double‑tap branches attempt to play it.
- ✅ Single‑tap hands‑free bug fix – On key‑up, if a long‑press timer fired but `recording` hasn’t turned true yet, cancel the pending session instead of leaving dictation running.
- ✅ No onboarding regressions – Left onboarding hotkey tests unchanged (already behave correctly); fixes are scoped to main pill handlers.

## Technical Implementation
- Introduced `startCuePlayedRef` in `App.tsx` and reset on PTT down. Both long‑press start and double‑tap start now check the flag before playing `playToggleOn()` and set it when played.
- Adjusted PTT up handling: if `isLongPressRef.current` is true but `recording` is still false on release, call `cancel()` and dispatch `CANCEL` to snap UI back to IDLE. Prevents the “single‑tap starts hands‑free” race when the start timer beats the recording flip and the stop branch doesn’t run.
- Left thresholds as‑is (hold 80 ms, double‑tap window 220 ms) to minimize UX change; optional tuning noted below.

**Files Modified:**
- `src/components/App.tsx`
  - Add `startCuePlayedRef` and guard in long‑press and double‑tap start branches.
  - Update key‑up logic to `cancel()` when release precedes `recording=true` after a long‑press.

## Bugs & Issues Encountered
1. Double start sound on first dictation after idle
   - Root cause: both long‑press timer and double‑tap branch could play the cue; event timing on cold/idle caused overlap.
   - Fix: per‑gesture playback guard.
2. Single‑tap occasionally starts hands‑free (~300–400 ms tap)
   - Root cause: long‑press start timer fired but `recording` not yet true when key‑up arrived; stop branch skipped, leaving session running.
   - Fix: on key‑up, if flagged as long‑press but not recording, issue `cancel()` and reset pill state.

## Key Learnings
- Gesture handlers must account for async state flips (e.g., `recording=true` lags behind `start()`), especially after idle or wake when the event loop is jittery.
- A simple per‑gesture latch prevents both UX (double sound) and correctness (accidental toggle) issues without heavy refactors.

## Architecture Decisions
- Keep thresholds unchanged for now; add guards instead of widening timers to maintain responsiveness.
- Scope fixes to pill PTT handlers (renderer) to avoid changing native helper behavior and onboarding flows.

## Ready for Next Session
- 🔧 Optional: tighten debounce or slightly raise HOLD_MS (80→90–100) and/or lower key‑up debounce (25→10–15) if any residual edge cases appear.
- 🔧 Optional: add unit tests for gesture state machine (simulate down/up sequences and assert `recording`/cue behavior).

## Context for Future
These guards stabilize first‑gesture behavior after app launch/idle and prevent accidental hands‑free activation. They reduce perceived flakiness without altering intended gesture semantics, and provide a safer base for any future timing tweaks.

