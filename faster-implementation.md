# Sonic Flow: Performance Boost Task List

**Goal:** Achieve near real-time transcription with low latency and efficient resource usage on consumer hardware (GPU focus first).

**Status Summary (Post-AudioWorklet Migration):**
*   Successfully replaced `MediaRecorder` with an `AudioWorklet -> SharedArrayBuffer -> RingBuffer` pipeline.
*   Eliminated ~300-350ms of pre-processing latency (Blob creation, copying, decoding).
*   Current E2E latency (~950ms with Moonshine+WebGPU) is faster than the previous baseline *but* still processes the **entire clip** after the user stops recording.
*   **Next major step:** Implement true streaming inference in the worker for low latency-to-first-token.

## Core Architectural Changes (Streaming Pipeline)

*   [x] **Profiling:** Establish baseline performance metrics (documented in `profiling-results.md`).
*   [x] **Replace `MediaRecorder` with `AudioWorklet`:**
    *   [x] Create `audioworklet-processor.js` (in `public/` folder) to capture raw `Float32Array` PCM data.
    *   [x] Update `useTranscription` hook to initialize `AudioContext` (48kHz), manage `AudioWorkletNode`, `SharedArrayBuffer`, and related refs.
    *   [x] Implement `RingBuffer` class using `SharedArrayBuffer` for efficient, zero-copy audio transfer to the worker.
    *   [x] Implement downsampling (simple FIR) within the worker (`moonshine-worker.ts`) to convert 48kHz to 16kHz.
*   [ ] **Implement True Streaming Inference (Worker-Side):** **<- NEXT FOCUS**
    *   [ ] Modify worker's pull loop (`pullAndProcessAudio`) to trigger `asr()` calls on smaller, overlapping audio windows (e.g., every 250-500ms using the last N seconds of audio from the ring buffer).
    *   [ ] Adapt `asr()` call within the worker to potentially leverage KV caching if available/beneficial in the underlying model execution (`generate` options?). _(Needs investigation)_
    *   [ ] Implement logic in the worker to diff consecutive transcription results and post `'update'` messages with new tokens/text only.
    *   [ ] Refine worker state management (`busy` flag) to handle overlapping processing triggers if necessary (e.g., queueing or dropping triggers if ASR is too slow).
*   [-] **Implement VAD (Voice Activity Detection):** _(Lower Priority)_
    *   [-] Integrate a WASM VAD library.
    *   [-] Process audio chunks through VAD in the worker *before* sending to ASR.
    *   [-] Only trigger ASR windows when speech is detected.

## Model & Runtime Optimizations

*   [-] **Use `whisper-tiny.en` or other English-Specific Model:** Evaluate if switching from `moonshine-base-ONNX` offers significant speed/accuracy trade-offs.
*   [-] **Apply/Verify Quantization & Compute Types:**
    *   [-] Systematically test optimal `dtype` and `computeType` settings (`int8`, `q8`, `q4`) identified in `profiling-results.md` with the streaming pipeline.
    *   [-] Use the added worker log to confirm the actual `computeType` being used by WebGPU.
*   [-] **Tune WebGPU Knobs:**
    *   [-] Experiment with `env.backends.webgpu.powerPreference`.
    *   [-] Experiment with other relevant `env.backends.webgpu` settings.

## UX Enhancements for Perceived Speed

*   [ ] **Display Partial Transcripts:** (Dependent on Streaming Inference)
    *   [ ] Update `useTranscription` hook to handle `'update'` messages from the worker.
    *   [ ] Update UI (`App.tsx`, potentially `TranscriptionDisplay.tsx`) to render partial results as they arrive.
*   [ ] **Visual Feedback:**
    *   [ ] Add visual distinction (e.g., fade-in, color) for partial vs. final text.
    *   [ ] Debounce final text injection (clipboard/editor) until `'complete'`.

## Testing & Refinement

*   [x] **Continuous Profiling:** Re-run performance profiling after major changes (Streaming Inference, VAD, Quantization, etc.). Add results to `profiling-results.md`.
*   [x] **Accuracy Testing:** Subjectively evaluate transcription quality after optimizations.
*   [ ] **Memory Profiling:** Verify `SharedArrayBuffer` usage remains flat during recording using DevTools. _(Needs final check)_
*   [ ] **Cross-Hardware Testing:** Test on different consumer laptops once streaming lands.

---

**Open Questions (Influences Prioritization & Details):**

*   **Target Latency:** Aiming for <1s, ideally <500ms *perceived* latency-to-first-token via streaming.
*   **Streaming UX:** Live partial updates visible *during* speech is the goal.

---