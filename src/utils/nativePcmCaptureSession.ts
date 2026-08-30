import {
  createCapturedAudio,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  TARGET_SAMPLE_RATE_HZ,
} from "../config/audio";
import type { AudioCaptureSession } from "./audioCaptureSession";
import { Pcm16Accumulator } from "./pcm16Accumulator";

// Native AVAudioEngine capture bypasses the browser's WebRTC auto-gain control.
// Keep the PCM sent to STT untouched, but calibrate the pill-only meter so a
// normal unprocessed speaking level has comparable visual intensity.
const NATIVE_VISUAL_LEVEL_GAIN = 3;
const PCM16_LEVEL_GAIN = 4 / 32768;
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(
  new Uint16Array([1]).buffer,
)[0] === 1;

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
  private readonly retainedPcm = new Pcm16Accumulator();
  private readonly removeFrameListener: () => void;
  private readonly removeStoppedListener: () => void;
  private readonly removeErrorListener: () => void;
  private stopped = false;
  private cancelled = false;
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
    if (this.cancelled) {
      this.started = false;
      void window.audioCapture.cancel();
      throw new Error("Native PCM capture session was cancelled.");
    }
  }

  async stop(): Promise<CapturedAudio> {
    this.stopped = true;
    if (this.started && window.audioCapture && !this.cancelled) {
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

    const pcm16 = this.retainedPcm.take();
    return createCapturedAudio(pcm16, {
      sampleRateHz: this.targetSampleRateHz,
    });
  }

  cancel(): void {
    this.stopped = true;
    this.cancelled = true;
    this.stopResolver?.();
    this.stopResolver = null;
    this.stopRejecter = null;
    this.removeListeners();
    this.retainedPcm.clear();
    void window.audioCapture?.cancel();
  }

  discardBufferedPcm(): void {
    this.retainedPcm.clear();
  }

  private handleFrame(payload: Uint8Array | ArrayBuffer): void {
    if (this.stopped) return;

    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
      this.onError?.(new Error("Native audio returned an invalid PCM16 frame."));
      return;
    }

    const pcm16 = decodePcm16(bytes);

    if (this.retainPcm) this.retainedPcm.append(pcm16);
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

/**
 * Native capture is little-endian PCM16. On the macOS targets we can expose
 * the IPC byte payload as a typed view without copying or decoding each
 * sample. Keep a DataView fallback for unusual unaligned or big-endian
 * payloads so the bridge remains correct outside the normal path.
 */
function decodePcm16(bytes: Uint8Array): Int16Array {
  const sampleCount = bytes.byteLength / 2;
  if (HOST_IS_LITTLE_ENDIAN && bytes.byteOffset % 2 === 0) {
    return new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
  }

  const pcm16 = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index++) {
    pcm16[index] = view.getInt16(index * 2, true);
  }
  return pcm16;
}

function calculatePcm16Level(frame: Int16Array): number {
  if (frame.length === 0) return 0;

  let sumSquares = 0;
  for (let index = 0; index < frame.length; index++) {
    const sample = frame[index];
    sumSquares += sample * sample;
  }
  return Math.min(1, Math.sqrt(sumSquares / frame.length) * PCM16_LEVEL_GAIN);
}
