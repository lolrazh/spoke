/**
 * Typed Worker Messages
 * Defines the structure of all messages exchanged between workers and the main hook
 */

// === OUTGOING MESSAGES (Hook → Worker) ===

export interface InitWorkerMessage {
  type: "init";
  data: { sab: SharedArrayBuffer };
}

export interface InitializeAsrMessage {
  type: "initialize-local-asr";
}

export interface StartCaptureMessage {
  type: "start-capture";
}

export interface StopCaptureMessage {
  type: "stop-capture-and-transcribe";
  data?: { timestamp: number }; // Optional timing data
}

export type WorkerIncomingMessage =
  | InitWorkerMessage
  | InitializeAsrMessage
  | StartCaptureMessage
  | StopCaptureMessage;

// === INCOMING MESSAGES (Worker → Hook) ===

export interface SabInitializedMessage {
  status: "sab_initialized";
}

export interface ModelLoadingMessage {
  status: "asr_model_loading";
}

export interface ModelReadyMessage {
  status: "asr_model_ready";
}

export interface ModelProgressMessage {
  status: "model_progress";
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
  // Progress callback from Transformers.js can include additional fields
  [key: string]: unknown;
}

export interface CaptureStartedMessage {
  status: "capture_started";
}

export interface PartialTranscriptionMessage {
  status: "partial";
  delta: string;
}

export interface ProcessingFullAudioMessage {
  status: "processing_full_audio";
}

export interface CompletedTranscriptionMessage {
  status: "completed";
  transcription: string;
  timings?: Record<string, number>;
}

export interface WorkerErrorMessage {
  status: "error";
  error: string;
}

export type WorkerOutgoingMessage =
  | SabInitializedMessage
  | ModelLoadingMessage
  | ModelReadyMessage
  | ModelProgressMessage
  | CaptureStartedMessage
  | PartialTranscriptionMessage
  | ProcessingFullAudioMessage
  | CompletedTranscriptionMessage
  | WorkerErrorMessage;

// === UTILITY TYPES ===

export type WorkerMessageStatus = WorkerOutgoingMessage["status"];

// Type guard functions for runtime type checking
export function isPartialMessage(
  msg: WorkerOutgoingMessage,
): msg is PartialTranscriptionMessage {
  return msg.status === "partial";
}

export function isCompletedMessage(
  msg: WorkerOutgoingMessage,
): msg is CompletedTranscriptionMessage {
  return msg.status === "completed";
}

export function isErrorMessage(
  msg: WorkerOutgoingMessage,
): msg is WorkerErrorMessage {
  return msg.status === "error";
}

export function isModelReadyMessage(
  msg: WorkerOutgoingMessage,
): msg is ModelReadyMessage {
  return msg.status === "asr_model_ready";
}

// VAD Worker Messages
export interface VadInitMessage {
  type: "vad_init";
}

export interface VadInitializedMessage {
  type: "vad_initialized";
  success: boolean;
  error?: string;
}

export interface VadDetectMessage {
  type: "vad_detect";
  frameId: number;
  audioFrame: Float32Array;
}

export interface VadResultMessage {
  type: "vad_result";
  frameId: number;
  isSpeech: boolean;
  probability: number;
}

export interface VadErrorMessage {
  type: "vad_error";
  frameId?: number;
  error: string;
}

export type VadWorkerMessage = VadInitMessage | VadDetectMessage;

export type VadWorkerResponse =
  | VadInitializedMessage
  | VadResultMessage
  | VadErrorMessage;
