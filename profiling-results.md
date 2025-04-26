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

*Run Date: (Please fill in - e.g., YYYY-MM-DD)*

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

### Raw Console Output

```log
Run 1:
[useTranscription] Recording stopped.
[useTranscription] Processing Blob: 71163 bytes, type: audio/webm;codecs=opus
[useTranscription] Sending 70080 samples to worker...
[useTranscription] Worker message: {status: 'start'}
[useTranscription] Worker message: {status: 'complete', output: ' This is a transcription test for Sonic Club.', timings: {…}}
e2e-transcription: 9325.341064453125 ms
[useTranscription] Worker Timings: 
    Total: 9300.20 ms
    Feature Extraction: 437.00 ms
    Model Generation: 8861.30 ms
    Decoding: 1.90 ms
[App] Received transcription: "This is a transcription test for Sonic Club."
[App] Inserting text...

Run 2:
[useTranscription] Recording stopped.
[useTranscription] Processing Blob: 77252 bytes, type: audio/webm;codecs=opus
[useTranscription] Sending 75840 samples to worker...
[useTranscription] Worker message: {status: 'start'}
[useTranscription] Worker message: {status: 'complete', output: ' This is a transcript test for sonic flow', timings: {…}}
e2e-transcription: 9151.758056640625 ms
[useTranscription] Worker Timings: 
    Total: 9122.40 ms
    Feature Extraction: 445.70 ms
    Model Generation: 8675.40 ms
    Decoding: 1.30 ms
[App] Received transcription: "This is a transcript test for sonic flow"
[App] Inserting text...
```

---

## Implementation: Easy Wins 1 (Aggressive Quantization)

*Run Date: (Please fill in)*

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

### Raw Console Output

```log
Run 1:
[useTranscription] Recording stopped.
[useTranscription] Processing Blob: 77961 bytes, type: audio/webm;codecs=opus
[useTranscription] Sending 76800 samples to worker...
[useTranscription] Worker message: {status: 'start'}
[useTranscription] Worker message: {status: 'complete', output: " This is a transcription test for Sonic's low.", processingTime: 7968.399999991059}
e2e-transcription: 8360.15380859375 ms
[useTranscription] Worker processing time: 7968.40 ms
[App] Received transcription: "This is a transcription test for Sonic's low."
[App] Inserting text...

Run 2:
[useTranscription] Recording stopped.
[useTranscription] Processing Blob: 66297 bytes, type: audio/webm;codecs=opus
[useTranscription] Sending 65280 samples to worker...
[useTranscription] Worker message: {status: 'start'}
[useTranscription] Worker message: {status: 'complete', output: ' This is a transcription test for Sonic Club.', processingTime: 7884.20000000298}
e2e-transcription: 8295.784912109375 ms
[useTranscription] Worker processing time: 7884.20 ms
[App] Received transcription: "This is a transcription test for Sonic Club."
[App] Inserting text...
```

---

## Implementation: [Future Optimization Name]

*Run Date: ...*

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

### Raw Console Output

```log
// ...
``` 