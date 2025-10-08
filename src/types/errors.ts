/**
 * Structured error codes for user-facing error handling.
 * Organized by category with ranges:
 * - 1xxx: Network errors
 * - 2xxx: Authentication errors
 * - 3xxx: Permission errors
 * - 4xxx: Transcription errors
 * - 5xxx: LLM errors
 * - 9xxx: System errors
 */
export enum ErrorCode {
  // Network (1xxx)
  NETWORK_OFFLINE = 1001,
  NETWORK_TIMEOUT = 1002,
  WS_CONNECTION_FAILED = 1003,
  WS_DISCONNECTED = 1004,
  
  // Auth (2xxx)
  AUTH_REQUIRED = 2001,
  AUTH_SESSION_EXPIRED = 2002,
  
  // Permissions (3xxx)
  MIC_PERMISSION_DENIED = 3001,
  MIC_NOT_AVAILABLE = 3002,
  ACCESSIBILITY_PERMISSION_DENIED = 3003,
  
  // Transcription (4xxx)
  STT_API_ERROR = 4001,
  STT_TIMEOUT = 4002,
  AUDIO_TOO_LARGE = 4003,
  AUDIO_PROCESSING_FAILED = 4004,
  NO_SPEECH_DETECTED = 4005,
  
  // LLM (5xxx)
  LLM_API_ERROR = 5001,
  LLM_TIMEOUT = 5002,
  
  // System (9xxx)
  BUFFER_OVERFLOW = 9001,
  UNKNOWN_ERROR = 9999,
}

/**
 * Short, single-line error messages optimized for pill notification display.
 * Keep messages concise (~30-50 characters) to fit within pill width constraints.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Network
  [ErrorCode.NETWORK_OFFLINE]: "No internet connection",
  [ErrorCode.NETWORK_TIMEOUT]: "Connection timed out",
  [ErrorCode.WS_CONNECTION_FAILED]: "Connection failed",
  [ErrorCode.WS_DISCONNECTED]: "Connection lost",
  
  // Auth
  [ErrorCode.AUTH_REQUIRED]: "Sign in to dictate",
  [ErrorCode.AUTH_SESSION_EXPIRED]: "Session expired. Sign in again",
  
  // Permissions
  [ErrorCode.MIC_PERMISSION_DENIED]: "Microphone access needed",
  [ErrorCode.MIC_NOT_AVAILABLE]: "Microphone not available",
  [ErrorCode.ACCESSIBILITY_PERMISSION_DENIED]: "Accessibility access needed",
  
  // Transcription
  [ErrorCode.STT_API_ERROR]: "Transcription unavailable",
  [ErrorCode.STT_TIMEOUT]: "Transcription timed out",
  [ErrorCode.AUDIO_TOO_LARGE]: "Recording too long",
  [ErrorCode.AUDIO_PROCESSING_FAILED]: "Audio processing failed",
  [ErrorCode.NO_SPEECH_DETECTED]: "No speech detected",
  
  // LLM
  [ErrorCode.LLM_API_ERROR]: "Post-processing failed",
  [ErrorCode.LLM_TIMEOUT]: "Post-processing timed out",
  
  // System
  [ErrorCode.BUFFER_OVERFLOW]: "Network too slow",
  [ErrorCode.UNKNOWN_ERROR]: "Something went wrong",
};

/**
 * Structured error object for internal error handling
 */
export interface AppError {
  code: ErrorCode;
  message: string; // User-friendly message from ERROR_MESSAGES
  technicalMessage?: string; // Technical details for logging
  context?: Record<string, unknown>; // Additional context for debugging
  retryable: boolean;
}

/**
 * Server error response structure (from WebSocket)
 */
export interface ServerErrorResponse {
  type: "error";
  code?: number; // ErrorCode
  body?: string; // Fallback message
  retryable?: boolean;
  traceId?: string;
}

/**
 * Check if an error code is retryable based on its category
 */
export function isRetryableError(code: ErrorCode): boolean {
  // Network errors are typically retryable
  if (code >= 1000 && code < 2000) return true;
  
  // Transcription timeouts are retryable
  if (code === ErrorCode.STT_TIMEOUT || code === ErrorCode.LLM_TIMEOUT) return true;
  
  // Permission and auth errors are not retryable automatically
  if (code >= 2000 && code < 4000) return false;
  
  // Most other errors are not retryable
  return false;
}
