/**
 * Audio Configuration Constants
 * Centralized location for all audio-related constants used throughout the app
 */

// Post-roll tail capture to avoid clipping final syllables when user releases PTT
// Keep small to balance responsiveness vs. completeness
export const POST_ROLL_MS = 240;

// Canonical local capture format. 30 ms aligns with Silero VAD windows.
export const TARGET_SAMPLE_RATE_HZ = 16000;
export const PCM_CAPTURE_FRAME_MS = 30;
export const PCM_CAPTURE_FRAME_SAMPLES =
  (TARGET_SAMPLE_RATE_HZ * PCM_CAPTURE_FRAME_MS) / 1000;
