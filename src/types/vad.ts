export type VadDecision = {
  isSpeech: boolean;
  probability?: number;
};

export interface VadEngine {
  /** Initialize model/wasm */
  init(): Promise<void>;
  /** Process one 16 kHz window of mono Float32 PCM in [-1, 1] */
  process(window: Float32Array): VadDecision;
  /** Reset internal rolling state (new stream) */
  reset(): void;
  /** Dispose resources */
  dispose(): void;
}

export type VadEvent =
  | { type: "speech_start"; atMs: number }
  | { type: "speech_end"; atMs: number };


