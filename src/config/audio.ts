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
// Keep ordinary dictations on the single-shot path. Natural chunking is a
// safety mechanism for a genuinely long recording, not a replacement for the
// normal short-dictation transcription path.
export const LOCAL_STT_CHUNK_NATURAL_START_MS = 25 * 1000;
export const LOCAL_STT_CHUNK_MIN_NATURAL_MS = 8 * 1000;
export const LOCAL_STT_CHUNK_FORCED_MS = 25 * 1000;
export const LOCAL_STT_CHUNK_OVERLAP_MS = 750;
// Streaming VAD reports speech end after its 200ms redemption window. This
// extra pause makes the effective natural-boundary guard about 1.4s, close to
// the later legacy implementation's 1.5s sentence pause.
export const LOCAL_STT_CHUNK_NATURAL_BOUNDARY_DELAY_MS = 1200;
export const LOCAL_STT_MAX_REQUEST_MS = 30 * 1000;
