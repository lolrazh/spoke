# Audio Clipping & DSP Tuning

**Date:** 2025-09-03  
**Agent:** GPT-5 (Cursor)  
**Status:** ✅ Completed  

## User Intention
Reduce start/end clipping during dictation and improve capture quality by tuning the client audio pipeline. The goal was to make dictation feel immediate (no lost first syllable), preserve the final syllable on stop, and configure WebRTC DSP features (AGC/NS/EC) to match real-world usage—favoring clarity without unwanted artifacts.

## What We Accomplished
- ✅ **Eliminated start clipping** – Added a 300ms initial passthrough so the first speech is streamed even before VAD decisions.
- ✅ **Eliminated end clipping** – Added tail-forward after `speech_end` and increased post-roll capture to 240ms.
- ✅ **Improved responsiveness** – Reduced frame size to 100ms for faster first-frame delivery.
- ✅ **DSP configuration aligned to user preference** – Enabled/disabled constraints to land on: echo cancellation OFF; noise suppression ON; auto gain control OFF.
- ✅ **Hardened mic constraint enforcement** – Applied `applyConstraints` on the track post-open to ensure settings stick.
- ✅ **Documentation updated** – Reflected new capture constraints and behavior in `docs/TRANSCRIPTION.md`.

## Technical Implementation
Start clipping was caused by a combination of VAD warmup/thresholds and large chunk size delaying the first emitted frame. We:
- Added an initial unconditional streaming window (~300ms) before gating.
- Reduced chunking to 100ms to lower first-frame latency.
- Increased post-roll and added a tail-forward window after `speech_end` so final syllables aren’t cut.
- Tuned VAD config (pre-roll, thresholds) and added a brief warmup to steady initial decisions.
- Explicitly set WebRTC constraints and re-applied them on the track to resist platform overrides.

**Files Modified:**
- `src/hooks/useTranscription.ts` – Initial 300ms passthrough; VAD warmup; post-init `applyConstraints`; constraint toggles; stop flow intact.
- `src/config/audio.ts` – `CHUNK_MS=100`; `POST_ROLL_MS=240`.
- `src/config/vad.ts` – Increased `PRE_ROLL_MS`; lowered `SPEECH_PROB_START`; reduced `MIN_SPEECH_MS`.
- `src/utils/vadStreamGate.ts` – Tail-forward after `speech_end` and ring-buffer handling.
- `docs/TRANSCRIPTION.md` – Updated capture constraint examples and notes.

## Bugs & Issues Encountered
1. **Start of dictation clipped** – First syllable missing when speaking immediately.
   - **Fix:** 300ms initial passthrough prior to gating; smaller 100ms frames; VAD warmup.
2. **End of dictation clipped** – Last syllable occasionally missing at stop.
   - **Fix:** Tail-forward post `speech_end` plus `POST_ROLL_MS=240` before teardown and `flush`.
3. **AGC pumping and noise lift** – Auto gain control raised room noise between words.
   - **Fix:** Disabled AGC while leaving noise suppression ON; echo cancellation kept OFF for dictation.

## Key Learnings
- **Boundary protection matters more than model speed** – A small initial passthrough and tail-forward dramatically improve perceived completeness.
- **Chunk size influences UX** – 100ms frames make the first frame appear quickly without excessive protocol overhead.
- **WebRTC DSP is context-sensitive** – AGC can hurt solo dictation by lifting noise; EC is most valuable for calls, not single-speaker capture.

## Architecture Decisions
- **Initial passthrough window (300ms)** – Chosen to guarantee early speech delivery despite VAD/model/WS timing; trade-off is a brief unconditional segment.
- **Tail-forward after `speech_end`** – Ensures natural cutoffs; minimal bandwidth increase, large UX gain.
- **DSP stance:** EC OFF, NS ON, AGC OFF – Optimized for dictation clarity; avoids pumping and artifacts.

## Ready for Next Session
- ✅ **Config knobs exposed** – Easy to tune initial bypass (200–400ms) and post-roll (160–300ms) if needed.
- 🔧 **Per-mic presets** – Optionally store DSP preferences per input device (future).
- 🔧 **Quality metrics** – Add capture level histogram and clipped-sample counters for diagnostics.

## Context for Future
These changes make dictation feel immediate and complete while keeping noise controlled. The pipeline is now tuned for single-speaker input; future work can layer per-device profiles and metrics-driven auto-tuning without revisiting core streaming or gating logic.


