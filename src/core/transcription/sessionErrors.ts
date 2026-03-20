export type TranscriptionSessionErrorCode =
  | "provider_not_configured"
  | "provider_unavailable"
  | "model_not_installed"
  | "permission_required"
  | "network_error"
  | "transcription_failed";

export class TranscriptionSessionError extends Error {
  readonly code: TranscriptionSessionErrorCode;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(
    code: TranscriptionSessionErrorCode,
    message: string,
    options: {
      recoverable?: boolean;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "TranscriptionSessionError";
    this.code = code;
    this.recoverable = options.recoverable ?? true;
    this.details = options.details;
  }
}

export function isTranscriptionSessionError(
  value: unknown,
): value is TranscriptionSessionError {
  return value instanceof TranscriptionSessionError;
}
