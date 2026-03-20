export type TranscriptionMode = "dictation" | "edit";

export type AuthErrorType =
  | "not_signed_in"
  | "payment_required"
  | "auth_failed"
  | null;

export type TranscriptionProviderKind = "local" | "cloud";

export interface TranscriptionQuotaInfo {
  wordsUsed: number;
  quotaLimit: number;
  subscriptionActive: boolean;
}

export interface TranscriptionContext {
  mode: TranscriptionMode;
  language?: string;
  identityName?: string;
  selectionText?: string;
  ocrWords?: string[];
}

export interface PrepareTranscriptionInput {
  authToken?: string | null;
  screenshotBase64?: string;
  context: TranscriptionContext;
}

export interface PrepareTranscriptionResult {
  authError?: Exclude<AuthErrorType, null>;
  ocrWords?: string[];
  quotaInfo?: TranscriptionQuotaInfo;
}

export interface TranscribeAudioInput {
  authToken?: string | null;
  audioBlob?: Blob;
  pcm16?: Int16Array;
  context: TranscriptionContext;
  prepareResult?: PrepareTranscriptionResult | null;
}

export interface TranscriptionResult {
  text: string;
  wordCount?: number;
  metrics?: Record<string, unknown>;
}
