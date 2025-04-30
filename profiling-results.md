# Sonic Flow: Performance Profiling Results

This document tracks performance measurements for different implementations of the transcription pipeline.

## Test Setup

*   **Hardware:** Asus ROG Zephyrus G15 2021, AMD Ryzen 9 5900HS + Nvidia RTX 3060
*   **Browser:** (Please fill in: e.g., Chrome v12X, Edge v12X)
*   **ONNX Runtime:** (via "@huggingface/transformers": "^3.0.0")
*   **Whisper Model:** onnx-community/whisper-tiny
*   **Test Audio:** "This is a transcription test, for Sonic Flow"

---

## Baseline (Current Implementation - Batch Mode)

### Metrics

*   **End-to-End (E2E) Latency:** (Time from `recorder.onstop` start to final text received in hook)
    *   Run 1: `9325.34 ms`
    *   Run 2: `9151.76 ms` 
    *   Run 3: `... ms` 
    *   Average: `~9239 ms` 
*   **Worker Processing Time (Total):** (Time spent *inside* the worker processing the audio chunk)
    *   Run 1: `9300.20 ms`
    *   Run 2: `9122.40 ms`
    *   Run 3: `... ms` 
    *   Average: `~9211 ms`
*   **Worker Granular Timings (Average):**
    *   Feature Extraction: `~441 ms`
    *   Model Generation: `~8768 ms`
    *   Decoding: `~1.6 ms`
*   **GPU Utilization / Timing (DevTools Observation):**
    *   (Please add observations from Performance tab: e.g., "GPU track shows consistent activity during processing for ~9s. Model Generation step clearly dominates GPU time. Main kernels observed: `matmul`, `attention`...")
*   **Main Thread Impact (DevTools Observation):**
    *   (Please add observations from Performance tab: e.g., "Main thread mostly idle during the ~9s worker processing time. No significant blocking observed.")

---

## Implementation: Easy Wins 1 (Aggressive Quantization)

*   **Changes Made:**
    *   Set `dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }`.
    *   Set `env.backends.webgpu.computeType = 'int8'`.

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `8360.15 ms`
    *   Run 2: `8295.78 ms`
    *   Average: `~8328 ms` (-8% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `7968.40 ms`
    *   Run 2: `7884.20 ms`
    *   Average: `~7926 ms` (-8% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   *(Granular timings not available in provided logs for this run)*
*   **GPU Observation:**
    *   (Add observations)
*   **Main Thread Impact:**
    *   (Add observations)
*   **Accuracy Observation:**
    *   Noticeable degradation compared to baseline (e.g., "Sonic's low", "Sonic Club" instead of "Sonic Flow"). Small speed gain might not justify accuracy loss with these settings.

---

## Implementation: Baseline + forceCompute=true (Discarded)

*   **Changes Made:**
    *   Added `env.backends.webgpu.forceCompute = true`.

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `9577.99 ms`
    *   Run 2: `9281.43 ms`
    *   Average: `~9430 ms` (+2% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `9545.80 ms`
    *   Run 2: `9251.70 ms`
    *   Average: `~9399 ms` (+2% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~436 ms`
    *   Model Generation: `~8961 ms`
    *   Decoding: `~1.7 ms` 
*   **GPU Observation:**
    *   (Add observations if different from baseline)
*   **Main Thread Impact:**
    *   (Add observations if different from baseline)
*   **Accuracy Observation:**
    *   No noticeable change from baseline.
*   **Result:** This change slightly increased latency, so it was reverted.

---

## Implementation: WASM Default Backend

*   **Changes Made:**
    *   Modified `getInstance` in `whisper-worker.ts` to bypass `webgpuAvailable()` check and always use WASM backend.
    *   (Kept baseline model `onnx-community/whisper-tiny` and baseline `dtype`)

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `9013.60 ms`
    *   Run 2: `9851.49 ms`
    *   Average: `~9433 ms` (+2.2% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `8988.00 ms`
    *   Run 2: `9827.60 ms`
    *   Average: `~9408 ms` (+2.3% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~553 ms` (+46% vs Baseline)
    *   Model Generation: `~8853 ms` (-0.5% vs Baseline)
    *   Decoding: `~1.3 ms` (-19% vs Baseline)
*   **GPU Observation:**
    *   N/A (WASM backend used)
*   **Main Thread Impact:**
    *   (Add observations if different from baseline)
*   **Accuracy Observation:**
    *   Run 2 had a minor hallucination ("Sonic Club" instead of "Sonic Flow"). May be random chance, needs more runs to confirm if related to backend.
*   **Result:** WASM default was slightly slower overall due to significantly slower Feature Extraction, despite faster Generation/Decoding. Reverted this change.

---

## Implementation: q8/q8 Quantization on WASM

*   **Changes Made:**
    *   Set `dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }`.
    *   (Kept baseline model `onnx-community/whisper-tiny`)

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `6218.35 ms`
    *   Run 2: `6025.94 ms`
    *   Average: `~6122 ms` (-33.7% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `6197.60 ms`
    *   Run 2: `6004.30 ms`
    *   Average: `~6101 ms` (-33.8% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~514 ms` (+16.5% vs Baseline)
    *   Model Generation: `~5585 ms` (-36.3% vs Baseline)
    *   Decoding: `~1.4 ms` (-12.5% vs Baseline)
*   **GPU Observation:**
    *   (Add observations)
*   **Main Thread Impact:**
    *   (Add observations)
*   **Accuracy Observation:**
    *   Accuracy seemed good, comparable to baseline.
*   **Result:** Significant performance improvement. Fastest configuration tested so far.

---

## Implementation: q8/q4 Quantization

*   **Changes Made:**
    *   Set `dtype: { encoder_model: 'q8', decoder_model_merged: 'q4' }`.
    *   (Kept baseline model `onnx-community/whisper-tiny`)

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `7468.11 ms`
    *   Run 2: `7282.07 ms`
    *   Average: `~7375 ms` (-20.2% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `7438.80 ms`
    *   Run 2: `7252.90 ms`
    *   Average: `~7346 ms` (-20.2% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~631 ms` (+43.1% vs Baseline)
    *   Model Generation: `~6713 ms` (-23.4% vs Baseline)
    *   Decoding: `~1.7 ms` (+6.3% vs Baseline)
*   **GPU Observation:**
    *   (Add observations)
*   **Main Thread Impact:**
    *   (Add observations)
*   **Accuracy Observation:**
    *   Accuracy seemed good, comparable to baseline.
*   **Result:** Faster than baseline, but slower than q8/q8. The q4 decoder didn't provide the expected speedup over q8 decoder.

---

## Implementation: q8/q8 Quantization + computeType=q8 w/ WebGPU

*Run Date: (Please fill in)*

*   **Changes Made:**
    *   Set `dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }`.
    *   Set `env.backends.webgpu.computeType = 'q8'`.
    *   Ensured WebGPU backend was preferred (default logic).
    *   (Kept baseline model `onnx-community/whisper-tiny`)

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `6586.57 ms`
    *   Run 2: `5932.54 ms`
    *   Average: `~6260 ms` (-32.2% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `6561.60 ms`
    *   Run 2: `5913.50 ms`
    *   Average: `~6238 ms` (-32.3% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~422 ms` (-4.4% vs Baseline)
    *   Model Generation: `~5814 ms` (-33.7% vs Baseline)
    *   Decoding: `~2.0 ms` (+25% vs Baseline)
*   **GPU Observation:**
    *   (Add observations - expect faster overall GPU time dominated by Gen)
*   **Main Thread Impact:**
    *   (Add observations - likely similar to baseline)
*   **Accuracy Observation:**
    *   Accuracy seemed good, comparable to baseline.
*   **Result:** Fastest configuration tested (~32% faster than baseline). `q8` compute on WebGPU provides significant speedup for the q8 model.

---

## Implementation: q4/q4 Quantization + computeType=q8 w/ WebGPU

*   **Changes Made:**
    *   Set `dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }`.
    *   Set `env.backends.webgpu.computeType = 'q8'`.
    *   Ensured WebGPU backend was preferred (default logic).
    *   (Kept baseline model `onnx-community/whisper-tiny`)

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `9748.29 ms`
    *   Run 2: `8979.39 ms`
    *   Average: `~9364 ms` (+1.3% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `9719.00 ms`
    *   Run 2: `8960.40 ms`
    *   Average: `~9340 ms` (+1.4% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~406 ms` (-7.9% vs Baseline)
    *   Model Generation: `~8932 ms` (+1.9% vs Baseline)
    *   Decoding: `~1.5 ms` (-6.25% vs Baseline)
*   **GPU Observation:**
    *   (Add observations - expect slower than baseline)
*   **Main Thread Impact:**
    *   (Add observations - likely similar to baseline)
*   **Accuracy Observation:**
    *   Accuracy seemed good, comparable to baseline.
*   **Result:** Slower than baseline. `int8` compute mode does not seem to benefit `q4` models on WebGPU, might even add overhead.

---

## Implementation: q8/q8 Quantization + computeType=int8 w/ WebGPU

*   **Changes Made:**
    *   Set `dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }`.
    *   Set `env.backends.webgpu.computeType = 'int8'`.
    *   Ensured WebGPU backend was preferred (default logic).
    *   (Kept baseline model `onnx-community/whisper-tiny`)

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `6022.11 ms`
    *   Run 2: `6067.66 ms`
    *   Average: `~6045 ms` (-34.6% vs Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `6003.60 ms`
    *   Run 2: `6048.70 ms`
    *   Average: `~6026 ms` (-34.6% vs Baseline)
*   **Worker Granular Timings (Average):** 
    *   Feature Extraction: `~357 ms` (-19.0% vs Baseline)
    *   Model Generation: `~5668 ms` (-35.4% vs Baseline)
    *   Decoding: `~1.25 ms` (-21.9% vs Baseline)
*   **GPU Observation:**
    *   (Add observations - should be fastest GPU time)
*   **Main Thread Impact:**
    *   (Add observations)
*   **Accuracy Observation:**
    *   Accuracy good ("...with Sonic Flow.").
*   **Result:** Verified fastest configuration. `int8` compute type yields slightly better performance than `q8` compute type for `q8/q8` models on WebGPU.

---

## Implementation: Moonshine Base (fp32/q4 Quantization) w/ WebGPU

*   **Changes Made:**
    *   Switched worker to `moonshine-worker.ts` using `pipeline()`.
    *   Model: `onnx-community/moonshine-base-ONNX`.
    *   Set `dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }`.
    *   Ensured WebGPU backend was preferred (default logic).

### Metrics

*   **Warm-up Time (First Run Only):** `~7354 ms`
*   **End-to-End (E2E) Latency:**
    *   Run 1: `1218.26 ms`
    *   Run 2: `1014.27 ms`
    *   Average: `~1116 ms` (-87.9% vs Whisper-tiny Baseline)
*   **Worker Processing Time (Total):**
    *   Run 1: `1195.40 ms`
    *   Run 2: `993.10 ms`
    *   Average: `~1094 ms` (-88.1% vs Whisper-tiny Baseline)
*   **Worker Granular Timings (Average):** 
    *   N/A (Pipeline abstraction does not expose sub-step timings)
*   **GPU Observation:**
    *   (Add observations - expect faster GPU time than Whisper-tiny)
*   **Main Thread Impact:**
    *   (Add observations - likely similar to baseline)
*   **Accuracy Observation:**
    *   Accuracy good ("Hi, this is a transcription test with Sonic Flow.", "This is a transcription test for Sonic Flow.").
*   **Result:** Significantly faster (~88%) than Whisper-tiny baseline with good accuracy using Moonshine-base fp32/q4 on WebGPU. Warm-up adds initial delay but subsequent transcriptions are very fast.

---

## Implementation: Moonshine Base (fp32/q8 Quantization) w/ WASM

*Run Date: (Assumed recent, please fill in)*

*   **Changes Made:**
    *   Model: `onnx-community/moonshine-base-ONNX`.
    *   Set `dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' }` (via WASM config).
    *   Forced WASM backend in `moonshine-worker.ts`.

### Metrics

*   **End-to-End (E2E) Latency:**
    *   Run 1: `1730.39 ms`
    *   Run 2: `1685.46 ms`
    *   Average: `~1708 ms` (-81.5% vs Whisper-tiny Baseline, +53% vs Moonshine WebGPU)
*   **Worker Processing Time (Total):**
    *   Run 1: `1714.40 ms`
    *   Run 2: `1671.20 ms`
    *   Average: `~1693 ms` (-81.6% vs Whisper-tiny Baseline, +55% vs Moonshine WebGPU)
*   **Worker Granular Timings (Average):** 
    *   N/A (Pipeline abstraction does not expose sub-step timings)
*   **GPU Observation:**
    *   N/A (WASM backend used)
*   **Main Thread Impact:**
    *   (Add observations)
*   **Accuracy Observation:**
    *   Accuracy good ("This is a transcription test with Sonic Flow.", "This is a transcription test with SonicFlow.").
*   **Result:** Still significantly faster (~81%) than Whisper-tiny baseline, but noticeably slower (~54%) than Moonshine on WebGPU. Accuracy remains good.

---

## Implementation: Moonshine Base (q8/q8 Quantization) w/ WASM

*   **Changes Made:**
    *   Model: `onnx-community/moonshine-base-ONNX`.
    *   Set `dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }` (via WASM config).
    *   Forced WASM backend in `moonshine-worker.ts`.

### Metrics

*   **Warm-up Time (First Run Only):** `~386 ms`
*   **End-to-End (E2E) Latency:**
    *   Run 1: `1399.06 ms`
    *   Run 2: `1362.52 ms`
    *   Average: `~1381 ms` (-85.0% vs Whisper-tiny Baseline, +23.7% vs Moonshine WebGPU, -19.1% vs Moonshine WASM fp32/q8)
*   **Worker Processing Time (Total):**
    *   Run 1: `1380.80 ms`
    *   Run 2: `1346.00 ms`
    *   Average: `~1363 ms` (-85.2% vs Whisper-tiny Baseline, +24.6% vs Moonshine WebGPU, -19.5% vs Moonshine WASM fp32/q8)
*   **Worker Granular Timings (Average):** 
    *   N/A (Pipeline abstraction does not expose sub-step timings)
*   **GPU Observation:**
    *   N/A (WASM backend used)
*   **Main Thread Impact:**
    *   (Add observations)
*   **Accuracy Observation:**
    *   Accuracy good ("This is a transcription test for SonicFlow.").
*   **Result:** Fastest WASM configuration (~85% faster than Whisper baseline). q8 quantization significantly improves WASM speed compared to fp32 encoder. Still slower than WebGPU but a good fallback.

---

## Implementation: AudioWorklet + RingBuffer (Moonshine Base)

*   **Changes Made:**
    *   Replaced `MediaRecorder` with `AudioWorklet`, `RingBuffer`, and `SharedArrayBuffer`.
    *   Worker now pulls 48kHz audio from RingBuffer, downsamples to 16kHz, and concatenates before final ASR call.
    *   Using `Moonshine Base (fp32/q4 Quantization) w/ WebGPU` settings from previous best.

### Metrics

*   **Warm-up Time (First Run Only):** `~7700 ms` (Similar to previous Moonshine warm-up)
*   **End-to-End (E2E) Latency:** (Time from `processing_start` to `complete` message in hook - `console.time`)
    *   Run 1: `801.65 ms`
    *   Run 2: `1090.46 ms`
    *   Average: `~946 ms` (-15% vs Previous Moonshine WebGPU E2E)
*   **Worker Processing Time (Total):** (ASR pipeline time reported by worker `timings.total`)
    *   Run 1: `802.80 ms`
    *   Run 2: `1091.33 ms`
    *   Average: `~947 ms` (-13% vs Previous Moonshine WebGPU Worker Time)
*   **Worker Granular Timings (Average):** 
    *   N/A (Pipeline abstraction)
*   **GPU Observation:**
    *   (Add observations - expect similar to previous Moonshine WebGPU run)
*   **Main Thread Impact:**
    *   (Add observations - expect negligible impact during recording and processing)
*   **Memory Observation:**
    *   (Add observations - check `ArrayBuffer` memory in DevTools during recording, should be flat)
*   **Accuracy Observation:**
    *   Accuracy good ("Hi, this is a transcription test with Sonic Flow."). No degradation observed.
*   **Result:** Successful migration! Achieved the goal of removing `MediaRecorder` overhead. E2E Latency seems slightly *faster* than the previous Moonshine baseline, potentially due to eliminating Blob creation/decoding (~150ms faster on average). Accuracy remains high. Memory usage during recording needs confirmation via DevTools.

---