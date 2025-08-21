/**
 * Audio Configuration Constants
 * Centralized location for all audio-related constants used throughout the app
 */

// Primary sample rates
export const TARGET_AUDIO_CONTEXT_RATE = 48000; // The rate the browser and mic hardware runs at
export const MICROPHONE_PREFERRED_RATE = 48000; // Preferred microphone capture rate
export const TARGET_SAMPLE_RATE = 16000; // The rate the ASR model expects

// PCM/Chunking
export const PCM_BITS_PER_SAMPLE = 16;
export const PCM_CHANNELS = 1;
export const CHUNK_MS = 100; // 100 ms chunks for now
export const SAMPLES_PER_CHUNK = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000; // 1600 samples
export const BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8; // 2 bytes for Int16
