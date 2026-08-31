import type { CapturedAudio } from "./capturedAudio";
import type { LocalModelTarget } from "../../types/shared";

export type TranscriptionMode = "dictation" | "edit";

export type TranscriptionProviderKind = "local" | "cloud";

export interface TranscriptionContext {
  mode: TranscriptionMode;
  language?: string;
  /**
   * Optional vocabulary/decoding-hint prompt (built via
   * `shared/sttPrompt.ts#buildSTTPrompt`) passed through to the local STT
   * sidecar's Whisper engine as an initial_prompt-style hint. Ignored by
   * providers/engines that don't support prompt conditioning.
   */
  sttPrompt?: string;
}

export interface PrepareTranscriptionInput {
  context: TranscriptionContext;
}

export interface PrepareTranscriptionResult {
  localModel?: LocalModelTarget;
}

export interface TranscribeAudioInput {
  audio: CapturedAudio;
  context: TranscriptionContext;
  prepareResult?: PrepareTranscriptionResult | null;
}

export interface TranscriptionResult {
  text: string;
  metrics?: Record<string, unknown>;
}
