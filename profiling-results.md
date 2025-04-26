# Sonic Flow: Performance Profiling Results

This document tracks performance measurements for different implementations of the transcription pipeline.

## Test Setup

*   **Hardware:** Asus ROG Zephyrus G15 2021, AMD Ryzen 9 5900HS + Nvidia RTX 3060
*   **Browser:** (Please fill in: e.g., Chrome v12X, Edge v12X)
*   **ONNX Runtime:** (Should be consistent, but note if version changes)
*   **Whisper Model:** onnx-community/whisper-tiny
*   **Test Audio:** "This is a transcription test, for Sonic Flow"

---

## Baseline (Current Implementation - Batch Mode)

*Run Date: (Please fill in - e.g., YYYY-MM-DD)*

### Metrics

*   **End-to-End (E2E) Latency:** (Time from `recorder.onstop` start to final text received in hook)
    *   Run 1: `9474.66 ms`
    *   Run 2: `8663.42 ms`
    *   Run 3: `... ms` (Add if you do more runs)
    *   Average: `~9069 ms`
*   **Worker Processing Time:** (Time spent *inside* the worker processing the audio chunk - receiving 'generate' to sending 'complete')
    *   Run 1: `8960.50 ms`
    *   Run 2: `8270.90 ms`
    *   Run 3: `... ms` (Add if you do more runs)
    *   Average: `~8616 ms`
*   **GPU Utilization / Timing (DevTools Observation):**
    *   (Please add observations from Performance tab: e.g., "GPU track shows consistent activity during processing for ~8-9s. Main kernels observed: `matmul`, `attention`... Total GPU time roughly matches worker time.")
*   **Main Thread Impact (DevTools Observation):**
    *   (Please add observations from Performance tab: e.g., "Main thread mostly idle during the ~9s worker processing time. No significant blocking observed.")

### Raw Console Output

```log
Run 1:
[useTranscription] Recording stopped.
[useTranscription] Processing Blob: 90547 bytes, type: audio/webm;codecs=opus
[useTranscription] Sending 89280 samples to worker...
[useTranscription] Worker message: {status: 'start'}
[useTranscription] Worker message: {status: 'complete', output: ' This is a transcription test for Sonic flow.', processingTime: 8960.5}
e2e-transcription: 9474.655029296875 ms
[useTranscription] Worker processing time: 8960.50 ms
[App] Received transcription: "This is a transcription test for Sonic flow."
[App] Inserting text...

Run 2:
[useTranscription] Recording stopped.
[useTranscription] Processing Blob: 72063 bytes, type: audio/webm;codecs=opus
[useTranscription] Sending 71040 samples to worker...
[useTranscription] Worker message: {status: 'start'}
[useTranscription] Worker message: {status: 'complete', output: ' This is a transcription test for Sonic Flow.', processingTime: 8270.90000000596}
e2e-transcription: 8663.4208984375 ms
[useTranscription] Worker processing time: 8270.90 ms
[App] Received transcription: "This is a transcription test for Sonic Flow."
[App] Inserting text...
```

---

## Implementation: [Future Optimization Name]

*Run Date: ...*

*   **Changes Made:** (Briefly describe changes, e.g., "Switched to tiny.en", "Added VAD")

### Metrics

*   **E2E Latency:** ...
*   **Worker Processing Time:** ...
*   **GPU Observation:** ...
*   **Main Thread Impact:** ...

### Raw Console Output

```log
// ...
``` 