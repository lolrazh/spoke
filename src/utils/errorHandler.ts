import {
  ErrorCode,
  ERROR_MESSAGES,
  isRetryableError,
  type AppError,
  type ServerErrorResponse,
} from "../types/errors";

/**
 * Create an AppError from an error code
 */
export function createAppError(
  code: ErrorCode,
  technicalMessage?: string,
  context?: Record<string, unknown>,
): AppError {
  return {
    code,
    message: ERROR_MESSAGES[code] || ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR],
    technicalMessage,
    context,
    retryable: isRetryableError(code),
  };
}

/**
 * Parse a server error response and convert to AppError
 */
export function parseServerError(serverError: ServerErrorResponse): AppError {
  const code = (serverError.code as ErrorCode) || ErrorCode.UNKNOWN_ERROR;
  const message =
    ERROR_MESSAGES[code] ||
    serverError.body ||
    ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR];

  return {
    code,
    message,
    technicalMessage: serverError.body,
    context: { traceId: serverError.traceId },
    retryable: serverError.retryable ?? isRetryableError(code),
  };
}

/**
 * Detect network connectivity errors
 */
export function detectNetworkError(): AppError | null {
  if (!navigator.onLine) {
    return createAppError(
      ErrorCode.NETWORK_OFFLINE,
      "Browser reports offline",
      { onLine: navigator.onLine },
    );
  }
  return null;
}

/**
 * Parse getUserMedia errors to appropriate error codes
 */
export function parseMediaError(error: unknown): AppError {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return createAppError(ErrorCode.MIC_PERMISSION_DENIED, error.message, {
          errorName: error.name,
        });
      case "NotFoundError":
      case "DevicesNotFoundError":
        return createAppError(ErrorCode.MIC_NOT_AVAILABLE, error.message, {
          errorName: error.name,
        });
      case "NotReadableError":
      case "TrackStartError":
        return createAppError(ErrorCode.MIC_NOT_AVAILABLE, error.message, {
          errorName: error.name,
        });
      default:
        return createAppError(ErrorCode.UNKNOWN_ERROR, error.message, {
          errorName: error.name,
        });
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return createAppError(ErrorCode.UNKNOWN_ERROR, message);
}

/**
 * Log error details to console for debugging
 */
export function logError(error: AppError, prefix = "[Error]"): void {
  console.error(prefix, {
    code: error.code,
    message: error.message,
    technical: error.technicalMessage,
    retryable: error.retryable,
    context: error.context,
  });
}

/**
 * Get user-friendly error message for display in notification
 */
export function getUserMessage(error: AppError): string {
  return error.message;
}
