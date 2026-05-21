import type { CapturedAudio } from "./capturedAudio";

export type TranscriptionMode = "dictation" | "edit";

export type TranscriptionProviderKind = "local" | "cloud";

export interface TranscriptionContext {
  mode: TranscriptionMode;
  language?: string;
  identityName?: string;
  selectionText?: string;
  ocrWords?: string[];
}

export interface PrepareTranscriptionInput {
  screenshotBase64?: string;
  context: TranscriptionContext;
}

export interface PrepareTranscriptionResult {
  ocrWords?: string[];
}

export interface TranscribeAudioInput {
  audio: CapturedAudio;
  context: TranscriptionContext;
  prepareResult?: PrepareTranscriptionResult | null;
}

export interface TranscriptionResult {
  text: string;
  wordCount?: number;
  metrics?: Record<string, unknown>;
}
