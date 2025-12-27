/**
 * VAD Configuration
 * Centralized settings and feature flags for voice activity detection.
 */

export const VAD_ENABLED = true;

// Modes: currently only gate silence; auto-chunking can be added later
export type VadMode = "gate" | "autoChunk";
export const VAD_MODE: VadMode = "gate";

// Inference/windowing
export const WINDOW_MS = 30; // typical for Silero
export const SAMPLE_RATE_HZ = 16000; // engine assumes 16kHz

// Rolling buffers
export const PRE_ROLL_MS = 300; // extend leading context to avoid clipping starts
export const POST_ROLL_MS_VAD = 160; // trailing context (distinct from capture POST_ROLL_MS)

// Hysteresis / policy
export const SPEECH_PROB_START = 0.7; // start a bit earlier to avoid clipping
export const SPEECH_PROB_END = 0.5; // maintain speech through brief dips
export const MIN_SPEECH_MS = 120; // reduce start delay while filtering clicks
export const MIN_SILENCE_MS = 200; // avoid premature cut-offs

// ─────────────────────────────────────────────────────────────────────────────
// Chunking Configuration (for incremental transcription)
// ─────────────────────────────────────────────────────────────────────────────

/** Enable chunk detection for incremental transcription.
 *  DISABLED: Chunking causes worker hangs due to orphaned async operations.
 *  See: agent-logs/2025-12-12 investigation */
export const CHUNK_DETECTION_ENABLED = false;

/** Minimum audio duration before we consider chunking (ms).
 *  Groq bills 10s minimum, so chunking at <8s wastes money. */
export const MIN_CHUNK_AUDIO_MS = 8000;

/** Silence duration that indicates a sentence boundary (ms).
 *  1500ms = true "full stop" pause, not a brief thinking gap. */
export const SENTENCE_PAUSE_MS = 1500;

/** Speech probability threshold for considering it "silence" for chunking.
 *  Lower than SPEECH_PROB_END since we want definite pauses. */
export const CHUNK_SILENCE_PROB = 0.3;

// Asset locations (served from public/)
// Match user's placement under public/vad
export const MODEL_URL = "/vad/silero_vad.onnx";
export const ORT_WASM_BASE_URL = "/vad/ort-wasm/"; // directory containing *.wasm files

function resolveAssetUrl(relPath: string): string {
  try {
    const base =
      (import.meta as unknown as { env?: Record<string, unknown> })?.env
        ?.BASE_URL ?? "./";
    const joined = `${String(base).replace(/\/$/, "")}${relPath.startsWith("/") ? relPath : `/${relPath}`}`;
    return new URL(
      joined,
      typeof window !== "undefined" ? window.location.href : "file://",
    ).toString();
  } catch {
    return relPath; // best-effort
  }
}

export function getVadModelURL(): string {
  return resolveAssetUrl(MODEL_URL);
}

export function getOrtWasmBaseURL(): string {
  // Ensure trailing slash for prefix semantics expected by ORT
  const url = resolveAssetUrl(ORT_WASM_BASE_URL);
  return url.endsWith("/") ? url : `${url}/`;
}
