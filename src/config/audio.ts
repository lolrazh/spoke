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
// Larger chunks improve WS reliability by reducing frame count (fewer chances for gaps)
// 400 ms is a good balance: aligns to 10 ms windows (40x) and keeps tail low due to explicit flush on stop
export const CHUNK_MS = 400; // was 100 ms
export const SAMPLES_PER_CHUNK = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000; // 6400 samples at 16k
export const BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8; // 2 bytes for Int16

// WebSocket streaming config
export const WS_MAX_BUFFERED_BYTES = 512 * 1024; // 512 KB backpressure threshold

// Post-roll tail capture to avoid clipping final syllables when user releases PTT
// Keep small to balance responsiveness vs. completeness
export const POST_ROLL_MS = 160;

// Feature flag: streaming v2 (100 ms frames)
export function streamingV2Enabled(): boolean {
  try {
    const env: any = (import.meta as any)?.env || {};
    if (
      env?.VITE_WS_STREAMING_V2 === "1" ||
      env?.VITE_WS_STREAMING_V2 === "true"
    )
      return true;
  } catch {}
  try {
    if (typeof window !== "undefined") {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("wsV2") === "1") return true;
      if (window.localStorage?.getItem("sf.wsV2") === "1") return true;
    }
  } catch {}
  return false;
}
