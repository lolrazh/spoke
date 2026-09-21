/**
 * Audio Configuration Constants
 * Centralized location for all audio-related constants used throughout the app
 */

// Post-roll tail capture to avoid clipping final syllables when user releases PTT
// Keep small to balance responsiveness vs. completeness
export const POST_ROLL_MS = 240;

// Canonical local capture format. 96 ms is one complete Silero VAD window.
export const TARGET_SAMPLE_RATE_HZ = 16000;
const PCM_CAPTURE_FRAME_MS = 96;
export const PCM_CAPTURE_FRAME_SAMPLES =
  (TARGET_SAMPLE_RATE_HZ * PCM_CAPTURE_FRAME_MS) / 1000;

// Local Parakeet uses full relative attention, so one unbounded request can
// grow its working set catastrophically. These are deliberately separate
// from the five-minute user-facing recording limit: Spoke cuts the recording
// into invisible, bounded requests while the user keeps talking.
export const LOCAL_DICTATION_MAX_DURATION_MS = 5 * 60 * 1000;
// Chunks are only ever cut inside a VAD-detected pause and never overlap.
// Recordings shorter than the minimum stay on the single-shot path. A
// sentence pause closes a chunk once it is at least this long; a speaker who
// never pauses that long is cut at their most recent breath at the maximum.
// The maximum is a hard bound on one request and matches the sidecar's
// 30-second per-request safety limit.
export const LOCAL_STT_CHUNK_MIN_MS = 15 * 1000;
export const LOCAL_STT_CHUNK_MAX_MS = 30 * 1000;
// Streaming VAD reports speech end after its 200ms redemption window. This
// extra silence makes the effective sentence pause about 1.4s.
export const LOCAL_STT_CHUNK_PAUSE_GUARD_MS = 1200;
