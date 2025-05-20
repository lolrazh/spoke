# Audio Processing

This directory contains modules related to audio capture and processing for the speech-to-text pipeline.

## Resampling (`resample.ts`)

The `resample.ts` module is responsible for converting audio from the input sample rate (e.g., 48kHz from the microphone) to the target sample rate required by the ASR model (16kHz).

Currently, it contains a placeholder for a high-quality sinc-based polyphase resampler. This should be implemented to ensure optimal audio quality for the ASR engine, which can significantly impact transcription accuracy.

The resampling is performed within the `AudioWorkletProcessor` (`public/audioworklet-processor.js`) before the audio data is written to the shared ring buffer. This keeps the computationally intensive resampling task off the main browser thread and the ASR worker thread. 