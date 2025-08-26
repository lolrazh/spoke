# Latency and Reveal Polish

**Date:** 2025-08-25  
**Agent:** OpenAI Codex CLI  
**Status:** ⚠️ Partial  

## User Intention
Improve perceived responsiveness and UX polish across dictation: make the start cue feel instantaneous, prevent end-of-speech from being clipped, make the processing/loading animation feel faster but keep its visual character, and eliminate the white “ghost box” on app start so the pill reveals tastefully. Maintain smooth behavior for both dev and packaged app.

## What We Accomplished
- ✅ **Start sound latency fixed** – Play start cue immediately within `start()` and removed artificial 25ms delay in the audio helper.
- ✅ **End-of-speech clipping mitigated** – Added short post‑roll capture before teardown, then flush and drain frames prior to `end` signaling.
- ✅ **Hotkey responsiveness improved** – Reduced debounce and hold durations for faster PTT feel.
- ✅ **Loading animation tuned (faster, same look)** – Restored original pulse shape and radiance, shortened cycle to increase energy while preserving style.
- ✅ **Startup ghost box removed** – Early transparency guard and renderer→main “ready-to-reveal” handshake to show only after styles/fonts are applied.
- ⚠️ **Springy pill reveal/hide** – Planned; handshake in place but pill FSM “REVEALING” state and animated exit not implemented yet.

## Technical Implementation
- Start cue latency: trigger `playToggleOn()` before opening the mic; preloaded HTMLAudio elements; removed `setTimeout` from start cue.
- End-of-speech: add `POST_ROLL_MS=160`; on stop, wait tail → `flush` worklet → `waitForAllFramesSent()` → disconnect/close → send `end` (with connect/open guard).
- PTT: reduced debounce and hold in both App and Onboarding.
- Loading dots: kept the original keyframes and visual weights; reduced cycle duration to 300ms; adjusted staggers proportionally.
- Startup reveal: inline CSS transparency guard in `index.html`; renderer waits for `document.fonts.ready` then notifies main via `rendererReady`; main shows only after this handshake.

**Files Modified:**
- `src/hooks/useTranscription.ts` – Start cue timing, POST_ROLL_MS tail, stop flow ordering (flush/drain before `end`).
- `src/utils/audioFeedback.ts` – Remove 25ms delay for start cue.
- `src/utils/audioFeedback.test.ts` – Adjust tests for immediate start cue.
- `src/components/App.tsx` – Debounce 25ms, hold 80ms.
- `src/components/Onboarding.tsx` – Debounce 25ms, hold 90ms.
- `src/config/audio.ts` – Added `POST_ROLL_MS = 160`.
- `src/index.css` – Faster processing dots while preserving original look.
- `index.html` – Early transparency guard to avoid white flash.
- `src/preload.ts` – Expose `rendererReady()`.
- `src/types/electron.d.ts` – Typing for `rendererReady()`.
- `src/renderer.tsx` – Send `rendererReady` after fonts/styling ready.
- `src/main.ts` – Stop showing on `ready-to-show`; listen for `renderer-ready` to show and top-align.

## Bugs & Issues Encountered
1. **Perceived lag on start cue** – Users heard the start sound late.
   - **Fix:** Play cue before `getUserMedia` and remove the 25ms delay.
2. **Clipped endings when releasing hotkey** – Last syllables missing on stop.
   - **Fix:** Add ~160ms post‑roll capture, then flush and drain before sending `end`.
3. **Startup “white ghost box”** – Brief unstyled paint before pill renders.
   - **Fix:** Inline CSS transparency guard + renderer→main handshake to reveal only when styled.
4. **Over-energetic loading effect after initial tweak** – Look diverged (“sparkly/fireworks”).
   - **Fix:** Restore original keyframes/scale/opacity and only shorten duration to keep the same radiance.

## Key Learnings
- **Start cue timing matters more than mic-open timing** – Playing audio before `getUserMedia` removes a large chunk of perceived latency.
- **Tail capture is critical for natural cutoffs** – A small post‑roll avoids clipping without making stop feel sluggish.
- **Styled-first reveal beats timer-based delays** – Handshaking on fonts/styles readiness eliminates flashes across dev/prod without blanket timeouts.
- **Animation character > raw speed** – Preserving keyframe shape while shortening cycle gives energy without changing visual identity.

## Architecture Decisions
- **Show window on renderer-ready event** – Chosen to ensure first paint is correct; avoids “ghost” artifacts. Trade-off: requires a handshake; add a fallback if the signal never arrives.
- **Stop flow ordering** – Tail → flush → drain → disconnect/close → `end`; chosen to guarantee final frames are included and sequencing is robust under network variability.

## Ready for Next Session
- ✅ **Handshake in place** – Main/renderer wiring ready for reveal animation work.
- 🔧 **Pill reveal/hide FSM** – Add `REVEALING` state and springy entrance/exit; ensure symmetry on hide from tray.
- 🔧 **Perf marks** – Add main/renderer markers to quantify cold start (first paint to reveal).
- 🔧 **Tail/animation tuning** – Optionally tune `POST_ROLL_MS` (120–220ms) and processing cycle (280–320ms) with user feedback.

## Context for Future
This work improves immediate feel and visual polish for dictation, addressing both responsiveness (start/stop) and first impressions (startup). With the handshake and timing fixes in place, the next session can safely layer on tasteful reveal/hide animations and measure cold‑start objectively without risking UX regressions.

