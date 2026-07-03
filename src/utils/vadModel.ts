/**
 * Shared Silero VAD (@ricky0123/vad-web) model loading.
 *
 * A single `NonRealTimeVAD` instance (and its underlying ONNX session) is
 * created lazily and cached for the lifetime of the renderer. Both the
 * streaming VAD processor (src/utils/streamingVad.ts) and the post-hoc
 * fallback trimmer (src/utils/vadTrimmer.ts) share this instance so we never
 * pay for two WASM sessions at once.
 *
 * Consumers that need the frame-by-frame model API (rather than the
 * whole-clip `.run()` generator) can reach into `instance.frameProcessor`,
 * which vad-web exposes as a public field.
 */
import {
  getVadModelUrl,
  getVadOrtWasmBaseUrl,
  VAD_INIT_TIMEOUT_MS,
  VAD_MIN_SPEECH_MS,
  VAD_NEGATIVE_SPEECH_THRESHOLD,
  VAD_POSITIVE_SPEECH_THRESHOLD,
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
} from "../config/vad";

export type NonRealTimeVadInstance = Awaited<
  ReturnType<typeof import("@ricky0123/vad-web").NonRealTimeVAD.new>
>;

let vadPromise: Promise<NonRealTimeVadInstance> | null = null;

/** Kicks off model loading (if not already in flight) without waiting. */
export async function prewarmVadModel(): Promise<void> {
  await resolveVadModel(VAD_INIT_TIMEOUT_MS, 0);
}

/**
 * Resolves the shared VAD instance, bounded by `timeoutMs`. On failure the
 * cache is cleared so the next caller retries model creation from scratch.
 */
export async function resolveVadModel(
  timeoutMs: number,
  audioDurationMs: number,
): Promise<NonRealTimeVadInstance> {
  const pending = getVad();
  try {
    return await withVadTimeout(
      pending,
      timeoutMs,
      timeoutMs,
      audioDurationMs,
      "initialization",
    );
  } catch (error) {
    if (vadPromise === pending) {
      vadPromise = null;
    }
    throw error;
  }
}

/**
 * Discards the cached model instance so the next `resolveVadModel` call
 * rebuilds it from scratch. Callers use this after a processing failure
 * (e.g. an iteration timeout) that may have left the shared instance in a
 * bad state.
 */
export function invalidateVadModel(): void {
  vadPromise = null;
}

function getVad(): Promise<NonRealTimeVadInstance> {
  if (!vadPromise) {
    const pending = createVad()
      .then((vad) => {
        if (vadPromise === pending || vadPromise === null) {
          vadPromise = Promise.resolve(vad);
        }
        return vad;
      })
      .catch((error) => {
        if (vadPromise === pending) {
          vadPromise = null;
        }
        throw error;
      });
    vadPromise = pending;
  }
  return vadPromise;
}

async function createVad(): Promise<NonRealTimeVadInstance> {
  const vadWeb = await import("@ricky0123/vad-web");

  return vadWeb.NonRealTimeVAD.new({
    modelURL: getVadModelUrl(),
    modelFetcher: fetchArrayBuffer,
    positiveSpeechThreshold: VAD_POSITIVE_SPEECH_THRESHOLD,
    negativeSpeechThreshold: VAD_NEGATIVE_SPEECH_THRESHOLD,
    minSpeechMs: VAD_MIN_SPEECH_MS,
    preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
    redemptionMs: VAD_REDEMPTION_MS,
    submitUserSpeechOnPause: false,
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
      ort.env.wasm.initTimeout = VAD_INIT_TIMEOUT_MS;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = getVadOrtWasmBaseUrl();
    },
  });
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load VAD asset ${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

export function withVadTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  totalTimeoutMs: number,
  audioDurationMs: number,
  stage: "initialization" | "processing",
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(createVadTimeoutError(totalTimeoutMs, audioDurationMs, stage));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function createVadTimeoutError(
  timeoutMs: number,
  audioDurationMs: number,
  stage: "initialization" | "processing" = "processing",
): Error {
  const audioContext =
    audioDurationMs > 0
      ? ` while processing ${Math.round(audioDurationMs)}ms of audio`
      : "";

  return new Error(
    `VAD ${stage} timed out after ${Math.round(timeoutMs)}ms${audioContext}.`,
  );
}
