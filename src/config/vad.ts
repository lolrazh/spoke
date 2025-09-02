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
export const PRE_ROLL_MS = 200; // leading context to avoid clipping starts
export const POST_ROLL_MS_VAD = 160; // trailing context (distinct from capture POST_ROLL_MS)

// Hysteresis / policy
export const SPEECH_PROB_START = 0.6; // start speaking when prob >= 0.6
export const SPEECH_PROB_END = 0.4; // stop when prob <= 0.4
export const MIN_SPEECH_MS = 120; // ignore blips shorter than this
export const MIN_SILENCE_MS = 120; // debounce end

// Asset locations (served from public/)
// Match user's placement under public/vad
export const MODEL_URL = "/vad/silero_vad.onnx";
export const ORT_WASM_BASE_URL = "/vad/ort-wasm/"; // directory containing *.wasm files


