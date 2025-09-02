import type { VadDecision, VadEngine } from "@/types/vad";
import {
  MODEL_URL,
  ORT_WASM_BASE_URL,
  WINDOW_MS,
  SAMPLE_RATE_HZ,
} from "@/config/vad";

// Lazy imports typed as any to avoid pulling heavy types in the renderer bundle type-check
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let VadWeb: any | null = null;

/**
 * Silero-backed VAD engine using @ricky0123/vad-web over onnxruntime-web.
 * Single responsibility: run inference per window and return a boolean/probability.
 */
export class SileroVadEngine implements VadEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runner: any | null = null;
  private initialized = false;
  private windowSamples = Math.round((SAMPLE_RATE_HZ * WINDOW_MS) / 1000);

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!VadWeb) {
      try {
        // Dynamic import to avoid loading unless enabled
        VadWeb = await import("@ricky0123/vad-web");
      } catch (e) {
        throw new Error("Failed to load VAD wrapper: " + (e as Error).message);
      }
    }

    const opts = {
      modelURL: MODEL_URL,
      wasmURLPrefix: ORT_WASM_BASE_URL,
      sampleRate: SAMPLE_RATE_HZ,
      frameSamples: this.windowSamples,
      // Let wrapper manage its own internal state; we'll call process() per window
    } as const;

    try {
      this.runner = await VadWeb.default?.(opts) ?? (await VadWeb.VAD?.(opts));
      if (!this.runner) throw new Error("VAD runner unavailable");
      this.initialized = true;
    } catch (e) {
      throw new Error("Failed to initialize VAD engine: " + (e as Error).message);
    }
  }

  process(window: Float32Array): VadDecision {
    if (!this.initialized || !this.runner) return { isSpeech: true };
    try {
      const res = this.runner.process(window);
      // Normalize return shape: some wrappers return boolean, some object
      if (typeof res === "boolean") return { isSpeech: res };
      const isSpeech = !!res?.isSpeech || (typeof res?.probability === "number" && res.probability >= 0.5);
      const probability = typeof res?.probability === "number" ? res.probability : undefined;
      return { isSpeech, probability };
    } catch {
      // Fail-open: treat as speech to avoid data loss
      return { isSpeech: true };
    }
  }

  reset(): void {
    try { this.runner?.reset?.(); } catch {}
  }

  dispose(): void {
    try { this.runner?.release?.(); } catch {}
    this.runner = null;
    this.initialized = false;
  }
}

/** Simple energy-based fallback engine */
export class EnergyVadEngine implements VadEngine {
  private rmsThreshold: number;
  constructor(rmsThreshold = 0.01) {
    this.rmsThreshold = rmsThreshold;
  }
  async init(): Promise<void> {
    // no-op
  }
  process(window: Float32Array): VadDecision {
    let sum = 0;
    for (let i = 0; i < window.length; i++) sum += window[i] * window[i];
    const rms = Math.sqrt(sum / Math.max(1, window.length));
    return { isSpeech: rms >= this.rmsThreshold };
  }
  reset(): void {}
  dispose(): void {}
}


