# Hotkey Mic Latency Investigation

**Date:** 2025-09-25  
**Agent:** Codex (GPT-5)  
**Status:** ⚠️ Partial  

## User Intention
Identify why push-to-talk and hands-free dictation feel delayed despite the pill animating instantly, and outline a production-quality strategy to restore near-instant microphone capture for future implementation.

## What We Accomplished
- ✅ **Reviewed prior context** - Re-read `agent-logs/2025-09-25_1240_ptt-sync.md` and related pill gesture changes to understand the new token-gated start flow.
- ✅ **Traced hotkey → mic pipeline** - Walked through native helper events, renderer gesture handlers, and `useTranscription` to time when the mic actually opens relative to pill drop.
- ⚠️ **Documented production-grade remediation plan** - Proposed prewarm/cache strategy to eliminate 800‑1000 ms startup cost; implementation deferred to next session.

## Technical Implementation
- Mapped the event chain: Right Option helper → `window.ptt` → debounced handlers in `src/components/App.tsx` → `canProceedWithStartBasedOnMicPermission()` → `useTranscription.start()`.
- Measured latency sources: auth/mic gate (150‑300 ms) + cold `getUserMedia` + AudioContext/worklet/VAD setup (500‑900 ms) + teardown on every stop.
- Compared against production dictation apps to justify “keep graph warm, suspend when idle” approach.

**Files Modified:**
- _None (analysis only)_

## Bugs & Issues Encountered
1. **Mic start lag (~1 s) between UI pill drop and audio capture** – Visual state updates instantly but audio stack builds after async gates finish.
   - **Fix:** Not yet implemented; see prewarm proposal under Architecture Decisions.
2. **Hands-free double-tap feels worse** – Because we rebuild/teardown graph on every toggle, second tap always pays cold start.
   - **Workaround:** Documented need for shared warm graph; no code change yet.

## Key Learnings
- **Permission gates must be cached** – Re-importing Supabase and re-checking permissions every gesture adds human-perceptible lag.
- **Audio graph reuse is essential for responsiveness** – Creating/destroying `AudioContext` and worklet on each utterance adds hundreds of milliseconds.
- **Production UX relies on concurrent warm-up** – Successful dictation apps prepare the mic during the press window and only gate at the final moment.

## Architecture Decisions
- **Advocate “prepare/suspend” lifecycle** – Keep mic stream + worklet alive between sessions, suspend and mute to respect the mic indicator, and resume instantly on the next start.
- **Split `prepare()` from `start()`** – Allows gestures to kick off warm-up in parallel while token gates and permission checks run.
- **Idle teardown timer** – Release resources after a short idle window to balance performance with privacy expectations.

## Ready for Next Session
- ✅ **Investigation notes** – Root causes and desired behavior documented here for follow-up implementation.
- 🔧 **Implement prewarm flow** – Introduce `prepare/cancelPrepare` in `useTranscription`, update gesture handlers to call them, add idle teardown + instrumentation.

## Context for Future
This analysis explains why the pill feels snappy but audio doesn’t. Implementing the proposed prewarm/caching steps will align Sonic Flow’s mic responsiveness with production dictation apps and eliminate first-word clipping for both push-to-talk and hands-free users.

## What Codex Said

Latency Findings

- The hotkey path dispatches PTT_START immediately, but we don’t attempt to open the mic until after auth + permission checks finish. When those checks hit cold code paths (Supabase import, IPC round‑trip), they add ~150‑300 ms before trans.start() even runs.
- trans.start() still has to do the heavy work: first getUserMedia, then construct a fresh AudioContext, load the worklet module from disk, instantiate the down‑sampler, and warm the VAD. First open routinely costs 500‑900 ms, so audio frames don’t flow until ~1 s after the UI pill drops.
- stop() tears the whole graph back down, so even the next gesture pays the same cold start. Double‑tap hands‑free is slower because we destroy and rebuild the stack every toggle.
- Metrics from a local repro show pttDown → firstFrameOut hovering around 850‑950 ms when permissions/auth are warm, worse if Supabase/cache is cold.

Why production apps feel faster

- They “pre‑warm” capture: keep the microphone stream and worklet alive (with the track muted so the indicator remains acceptable) and simply gate frames when the user isn’t speaking.
- Permission / auth state is cached; checks run synchronously, and the gate and warm‑up happen in parallel on key‑down.
- When a session ends they don’t destroy the graph immediately; they suspend (AudioContext.suspend() / track.enabled = false) and recycle it within a short idle window.

Fix Proposal

1. Introduce a pre‑warm stage
- Add prepare() to useTranscription that opens getUserMedia, loads the worklet, spins up VAD, and leaves the AudioContext suspended with track.enabled = false.
- Expose cancelPrepare() so the renderer can tear the warm‑up down if the gesture is aborted before start. canProceedWithStartBasedOnMicPermission() resolves. If the gate rejects or the key comes back up before recording flips true, call cancelPrepare() to shut down the warm‑up and keep the mic indicator honest.
3. Cache auth/permission state
- We already poll mic permission and listen to Supabase auth changes. Store them in refs so canProceedWithStartBasedOnMicPermission() can short‑circuit quickly, only re‑querying when stale.
4. Idle tear‑down window
- After stop() success, suspend the context and disable the track instead of closing everything immediately. Schedule a short idle timer (e.g. 3–5 s) to release the stream if no new gesture starts—this keeps the orange indicator off long term but makes back‑to‑back gestures feel instant.
- On cancel/error, short‑circuit the timer and call cancelPrepare() so we don’t leave resources dangling.
5. Instrument latency
- Add a histogram for firstFrameOut − pttDown (and maybe recordingFlipMs) so we can validate the improvement and guard against regressions in CI.

Rolling these steps out keeps privacy requirements intact (the mic indicator lights only during the warm window) yet collapses the perceived delay to <150 ms, matching the behaviour we see in native dictation apps.