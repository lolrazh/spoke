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

// Local Parakeet uses full relative attention, so one unbounded request can
// grow its working set catastrophically. These are deliberately separate
// from the five-minute user-facing recording limit: Spoke cuts the recording
// into invisible, bounded requests while the user keeps talking.
export const LOCAL_DICTATION_MAX_DURATION_MS = 5 * 60 * 1000;
export const LOCAL_STT_CHUNK_MIN_NATURAL_MS = 8 * 1000;
export const LOCAL_STT_CHUNK_FORCED_MS = 25 * 1000;
export const LOCAL_STT_CHUNK_OVERLAP_MS = 750;
export const LOCAL_STT_MAX_REQUEST_MS = 30 * 1000;
