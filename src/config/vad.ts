export const VAD_SAMPLE_RATE_HZ = 16_000;

export const VAD_POSITIVE_SPEECH_THRESHOLD = 0.35;
export const VAD_NEGATIVE_SPEECH_THRESHOLD = 0.25;
export const VAD_MIN_SPEECH_MS = 120;
export const VAD_PRE_SPEECH_PAD_MS = 300;
export const VAD_REDEMPTION_MS = 200;
export const VAD_INIT_TIMEOUT_MS = 20_000;
export const VAD_MIN_TIMEOUT_MS = 5_000;
export const VAD_MAX_TIMEOUT_MS = 30_000;
export const VAD_TIMEOUT_AUDIO_MULTIPLIER = 4;

// The Silero VAD model keeps an onnxruntime-web WASM heap resident in the
// always-open pill renderer. Drop it after a stretch of no dictation so the
// heap can be reclaimed; a PTT key-down re-warms it (see prewarmVad), so the
// user rarely feels the cold start.
export const VAD_IDLE_RELEASE_MS = 5 * 60 * 1000;

export const VAD_MODEL_URL = "/vad/silero_vad_legacy.onnx";
export const VAD_ORT_WASM_BASE_URL = "/vad/ort-wasm/";

export function getVadModelUrl(): string {
  return resolveRendererAssetUrl(VAD_MODEL_URL);
}

export function getVadOrtWasmBaseUrl(): string {
  const url = resolveRendererAssetUrl(VAD_ORT_WASM_BASE_URL);
  return url.endsWith("/") ? url : `${url}/`;
}

function resolveRendererAssetUrl(path: string): string {
  try {
    const base =
      (import.meta as unknown as { env?: Record<string, unknown> }).env
        ?.BASE_URL ?? "./";
    const joined = `${String(base).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    return new URL(
      joined,
      typeof window !== "undefined" ? window.location.href : "file://",
    ).toString();
  } catch {
    return path;
  }
}
