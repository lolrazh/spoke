import type {
  PrepareTranscriptionInput,
  PrepareTranscriptionResult,
  TranscribeAudioInput,
  TranscriptionProviderKind,
  TranscriptionResult,
} from "./sessionTypes";

export interface TranscriptionProviderDescriptor {
  id: string;
  displayName: string;
  kind: TranscriptionProviderKind;
  requiresAuthToken: boolean;
  requiresApiKey: boolean;
}

export interface TranscriptionProviderAvailability {
  configured: boolean;
  available: boolean;
  reason?: string;
}

export interface TranscriptionProvider {
  descriptor: TranscriptionProviderDescriptor;
  getAvailability?: () =>
    | Promise<TranscriptionProviderAvailability>
    | TranscriptionProviderAvailability;
  prepare?: (
    input: PrepareTranscriptionInput,
  ) => Promise<PrepareTranscriptionResult>;
  transcribe: (
    input: TranscribeAudioInput,
  ) => Promise<TranscriptionResult>;
}
