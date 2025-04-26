# Sonic Flow: Performance Boost Task List

Goal: Achieve near real-time transcription with low latency and efficient resource usage on consumer hardware (GPU focus first).

## Core Architectural Changes (Streaming Pipeline)

*   [ ] **Profiling:** Establish baseline performance metrics for the *current* implementation (End-to-end latency, GPU/CPU time per transcription).
*   [ ] **Replace `MediaRecorder` with `AudioWorklet`:**
    *   [ ] Create `audioworklet-processor.js` (or similar) to capture raw `Float32Array` PCM data.
    *   [ ] Update `useTranscription` to initialize and use the `AudioWorkletNode`.
    *   [ ] Implement a ring buffer (`Float32Array`) in `useTranscription` to store recent audio.
    *   [ ] Implement downsampling (e.g., via `speex-resampler-wasm` or simple FIR) if needed (Worklet runs at `audioCtx.sampleRate`, Whisper needs 16kHz).
*   [ ] **Implement Chunked Sending:**
    *   [ ] Use `setInterval` or `requestAnimationFrame` in `useTranscription` to periodically extract audio windows from the ring buffer.
    *   [ ] Adapt `whisper-worker.ts` to receive and process `Float32Array` audio chunks.
    *   [ ] Handle potential overlapping requests in the worker (e.g., debounce or queue).
*   [ ] **Implement VAD (Voice Activity Detection):**
    *   [ ] Integrate a WASM VAD library (e.g., `onnxruntime-web` with Silero VAD, or `webrtcvad-wasm`).
    *   [ ] Process audio chunks through VAD *before* sending to the Whisper worker.
    *   [ ] Only send chunks to Whisper when speech is detected.

## Model & Runtime Optimizations

*   [ ] **Use `whisper-tiny.en` model:** Switch from multilingual `tiny` for potential speed/accuracy gains on English.
*   [ ] **Apply Aggressive Quantization:**
    *   [ ] Test `dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }`.
    *   [ ] Test `env.backends.webgpu.computeType: 'int8'`.
    *   [ ] Profile and evaluate accuracy trade-offs.
*   [ ] **Tune WebGPU Knobs:**
    *   [ ] Set `env.backends.webgpu.powerPreference = 'high-performance'`.
    *   [ ] Experiment with `env.backends.webgpu.forceCompute = true`.
    *   [ ] Experiment with `env.backends.webgpu.maxConcurrency` (needs testing on target hardware).
*   [ ] **(Advanced) Worker Audio Context Caching:** Implement logic in the worker to reuse parts of previous audio computations (simulating KV cache reuse).

## UX Enhancements for Perceived Speed

*   [ ] **Display Partial Transcripts:** Update `useTranscription` and UI (`App.tsx`) to handle `'update'` messages from the worker and display interim results.
*   [ ] **Visual Feedback:**
    *   [ ] Fade-in/opacity changes for partial vs. final text.
    *   [ ] Consider an animated caret or similar indicator for live updates.
    *   [ ] Debounce final text injection (e.g., to clipboard/editor) until `'complete'`.

## Testing & Refinement

*   [ ] **Continuous Profiling:** Re-run performance profiling after major changes (AudioWorklet, VAD, Quantization, etc.).
*   [ ] **Accuracy Testing:** Subjectively (and potentially objectively, if possible) evaluate transcription quality after optimizations, especially quantization.
*   [ ] **Cross-Hardware Testing:** Test on different consumer laptops (varying GPU/CPU capabilities) once major features land.

---

**Open Questions (Influences Prioritization & Details):**

*   **Target Latency:** What's our goal? (<1s perceived? <500ms?)
*   **English Only Confirmed?** (Affects model choice task)
*   **Streaming UX:** Just faster final results, or live partial updates visible *during* speech? (Affects UX tasks)

---

Does this look like a good starting point for `faster-implementation.md`? We can add, remove, or reorder as we go.

Once you confirm, I can create the file with this content. And definitely let me know the answers to those open questions when you can!