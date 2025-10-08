import { ErrorCode, ERROR_MESSAGES, isRetryableError, type AppError, type ServerErrorResponse } from "../types/errors";

/**
 * Create an AppError from an error code
 */
export function createAppError(
  code: ErrorCode,
  technicalMessage?: string,
  context?: Record<string, unknown>
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
  const message = ERROR_MESSAGES[code] || serverError.body || ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR];
  
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
      { onLine: navigator.onLine }
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
        return createAppError(
          ErrorCode.MIC_PERMISSION_DENIED,
          error.message,
          { errorName: error.name }
        );
      case "NotFoundError":
      case "DevicesNotFoundError":
        return createAppError(
          ErrorCode.MIC_NOT_AVAILABLE,
          error.message,
          { errorName: error.name }
        );
      case "NotReadableError":
      case "TrackStartError":
        return createAppError(
          ErrorCode.MIC_NOT_AVAILABLE,
          error.message,
          { errorName: error.name }
        );
      default:
        return createAppError(
          ErrorCode.UNKNOWN_ERROR,
          error.message,
          { errorName: error.name }
        );
    }
  }
  
  const message = error instanceof Error ? error.message : String(error);
  return createAppError(ErrorCode.UNKNOWN_ERROR, message);
}

/**
 * Parse WebSocket errors to appropriate error codes
 */
export function parseWebSocketError(
  event: Event | CloseEvent | string,
  context?: Record<string, unknown>
): AppError {
  // Check network connectivity first
  const networkError = detectNetworkError();
  if (networkError) return networkError;
  
  // CloseEvent with specific codes
  if (typeof event === "object" && "code" in event) {
    const closeEvent = event as CloseEvent;
    switch (closeEvent.code) {
      case 1000: // Normal closure
      case 1001: // Going away
        return createAppError(
          ErrorCode.WS_DISCONNECTED,
          closeEvent.reason || "WebSocket closed normally",
          { code: closeEvent.code, reason: closeEvent.reason, ...context }
        );
      case 1006: // Abnormal closure (no close frame)
        return createAppError(
          ErrorCode.WS_CONNECTION_FAILED,
          "Connection failed (abnormal closure)",
          { code: closeEvent.code, ...context }
        );
      case 1008: // Policy violation
      case 1009: // Message too large
      case 1011: // Internal error
        return createAppError(
          ErrorCode.WS_DISCONNECTED,
          closeEvent.reason || `WebSocket error (${closeEvent.code})`,
          { code: closeEvent.code, reason: closeEvent.reason, ...context }
        );
      default:
        return createAppError(
          ErrorCode.WS_DISCONNECTED,
          `WebSocket closed with code ${closeEvent.code}`,
          { code: closeEvent.code, reason: closeEvent.reason, ...context }
        );
    }
  }
  
  // Generic connection failure
  const technicalMessage = typeof event === "string" ? event : "WebSocket connection failed";
  return createAppError(ErrorCode.WS_CONNECTION_FAILED, technicalMessage, context);
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
