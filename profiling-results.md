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

## Implementation: [Future Optimization Name]

*   **Changes Made:** (Briefly describe changes, e.g., "Switched to tiny.en", "Added VAD")

### Metrics

*   **E2E Latency:** ...
*   **Worker Processing Time (Total):** ...
*   **Worker Granular Timings (Average):**
    *   Feature Extraction: `... ms`
    *   Model Generation: `... ms`
    *   Decoding: `... ms`
*   **GPU Observation:** ...
*   **Main Thread Impact:** ...

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