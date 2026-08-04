import {
  concatPcm16,
  createCapturedAudio,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  TARGET_SAMPLE_RATE_HZ,
} from "../config/audio";
import type { AudioCaptureSession } from "./audioCaptureSession";

// Native AVAudioEngine capture bypasses the browser's WebRTC auto-gain control.
// Keep the PCM sent to STT untouched, but calibrate the pill-only meter so a
// normal unprocessed speaking level has comparable visual intensity.
const NATIVE_VISUAL_LEVEL_GAIN = 3;

export interface NativePcmCaptureSessionOptions {
  targetSampleRateHz?: number;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onPcmFrame?: (frame: Int16Array) => void;
  retainPcm?: boolean;
}

export class NativePcmCaptureSession implements AudioCaptureSession {
  private readonly targetSampleRateHz: number;
  private readonly onAudioLevel?: (level: number) => void;
  private readonly onError?: (error: Error) => void;
  private readonly onPcmFrame?: (frame: Int16Array) => void;
  private readonly retainPcm: boolean;
  private readonly chunks: Int16Array[] = [];
  private readonly removeFrameListener: () => void;
  private readonly removeStoppedListener: () => void;
  private readonly removeErrorListener: () => void;
  private stopped = false;
  private started = false;
  private stopResolver: (() => void) | null = null;
  private stopRejecter: ((error: Error) => void) | null = null;

  constructor(options: NativePcmCaptureSessionOptions = {}) {
    this.targetSampleRateHz =
      options.targetSampleRateHz ?? TARGET_SAMPLE_RATE_HZ;
    this.onAudioLevel = options.onAudioLevel;
    this.onError = options.onError;
    this.onPcmFrame = options.onPcmFrame;
    this.retainPcm = options.retainPcm ?? true;

    const bridge = window.audioCapture;
    if (!bridge) {
      throw new Error("Native macOS audio capture is unavailable.");
    }

    this.removeFrameListener = bridge.onFrame((payload) => {
      this.handleFrame(payload);
    });
    this.removeStoppedListener = bridge.onStopped(() => {
      this.stopResolver?.();
      this.stopResolver = null;
      this.stopRejecter = null;
    });
    this.removeErrorListener = bridge.onError((message) => {
      const error = new Error(message);
      this.stopRejecter?.(error);
      this.stopResolver = null;
      this.stopRejecter = null;
      this.onError?.(error);
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Native PCM capture session is already started.");
    }
    if (this.stopped) {
      throw new Error("Native PCM capture session has already stopped.");
    }
    if (!window.audioCapture) {
      throw new Error("Native macOS audio capture is unavailable.");
    }

    await window.audioCapture.start();
    this.started = true;
  }

  async stop(): Promise<CapturedAudio> {
    this.stopped = true;
    if (this.started && window.audioCapture) {
      const stopped = new Promise<void>((resolve, reject) => {
        this.stopResolver = resolve;
        this.stopRejecter = reject;
      });
      try {
        await window.audioCapture.stop();
        await stopped;
      } finally {
        this.removeListeners();
      }
    } else {
      this.removeListeners();
    }

    const pcm16 = concatPcm16(this.chunks);
    this.chunks.length = 0;
    return createCapturedAudio(pcm16, {
      sampleRateHz: this.targetSampleRateHz,
    });
  }

  cancel(): void {
    this.stopped = true;
    this.stopResolver = null;
    this.stopRejecter = null;
    this.removeListeners();
    this.chunks.length = 0;
    void window.audioCapture?.cancel();
  }

  discardBufferedPcm(): void {
    this.chunks.length = 0;
  }

  private handleFrame(payload: Uint8Array | ArrayBuffer): void {
    if (this.stopped) return;

    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
      this.onError?.(new Error("Native audio returned an invalid PCM16 frame."));
      return;
    }

    const pcm16 = new Int16Array(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < pcm16.length; index++) {
      pcm16[index] = view.getInt16(index * 2, true);
    }

    if (this.retainPcm) this.chunks.push(pcm16);
    this.onAudioLevel?.(
      Math.min(1, calculatePcm16Level(pcm16) * NATIVE_VISUAL_LEVEL_GAIN),
    );
    this.onPcmFrame?.(pcm16);
  }

  private removeListeners(): void {
    this.removeFrameListener();
    this.removeStoppedListener();
    this.removeErrorListener();
  }
}

function calculatePcm16Level(frame: Int16Array): number {
  if (frame.length === 0) return 0;

  let sumSquares = 0;
  for (let index = 0; index < frame.length; index++) {
    const normalized = frame[index] / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumSquares / frame.length) * 4);
}
