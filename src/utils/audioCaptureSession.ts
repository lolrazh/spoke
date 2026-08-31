import type { CapturedAudio } from "../core/transcription/capturedAudio";

/**
 * Capture boundary shared by the browser fallback and native macOS capture.
 * Both implementations deliver mono PCM16 frames at the target rate, so VAD
 * and local chunking do not need to know which capture path produced them.
 */
export interface AudioCaptureSession {
  start(stream?: MediaStream): Promise<void>;
  stop(): Promise<CapturedAudio>;
  cancel(): void;
}
