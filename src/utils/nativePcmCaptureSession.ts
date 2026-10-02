import {
  createCapturedAudio,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  TARGET_SAMPLE_RATE_HZ,
} from "../config/audio";
import type { AudioCaptureSession } from "./audioCaptureSession";
import { Pcm16Accumulator } from "./pcm16Accumulator";

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
  private readonly sessionId = crypto.randomUUID();
  private readonly bridge: NonNullable<Window["audioCapture"]>;
  private readonly targetSampleRateHz: number;
  private readonly onAudioLevel?: (level: number) => void;
  private readonly onError?: (error: Error) => void;
  private readonly onPcmFrame?: (frame: Int16Array) => void;
  private readonly retainPcm: boolean;
  private readonly retainedPcm = new Pcm16Accumulator();
  private readonly removeFrameListener: () => void;
  private readonly removeLevelListener: (() => void) | undefined;
  private hasLiveLevels = false;
  private readonly removeStoppedListener: () => void;
  private readonly removeErrorListener: () => void;
  private stopped = false;
  private acceptingFrames = true;
  private cancelled = false;
  private started = false;
  private startRequested = false;
  private listenersRemoved = false;

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
    this.bridge = bridge;

    this.removeFrameListener = bridge.onFrame((payload) => {
      this.handleFrame(payload);
    }, this.sessionId);
    this.removeLevelListener = bridge.onLevel?.((rms) => {
      if (this.stopped) return;
      this.hasLiveLevels = true;
      this.onAudioLevel?.(rms);
    }, this.sessionId);
    this.removeStoppedListener = bridge.onStopped(() => {
      this.acceptingFrames = false;
      this.started = false;
    }, this.sessionId);
    this.removeErrorListener = bridge.onError((message) => {
      const error = new Error(message);
      this.onError?.(error);
    }, this.sessionId);
  }

  async start(): Promise<void> {
    if (this.startRequested) {
      throw new Error("Native PCM capture session is already started.");
    }
    if (this.stopped) {
      throw new Error("Native PCM capture session has already stopped.");
    }
    this.startRequested = true;
    try {
      await this.bridge.start(this.sessionId);
      if (this.cancelled) {
        throw new Error("Native PCM capture session was cancelled.");
      }
      this.started = true;
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  async stop(): Promise<CapturedAudio> {
    if (this.startRequested && !this.started && !this.cancelled) {
      this.cancel();
    }
    this.stopped = true;
    if (this.started && !this.cancelled) {
      try {
        // Main resolves this only after native stop or cancellation. Waiting
        // for a second renderer event can hang if ownership was already lost.
        await this.bridge.stop(this.sessionId);
      } catch (error) {
        this.cancel();
        throw error;
      } finally {
        this.started = false;
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
    if (this.cancelled) return;
    this.stopped = true;
    this.cancelled = true;
    this.removeListeners();
    this.retainedPcm.clear();
    if (this.startRequested) {
      void this.bridge.cancel(this.sessionId).catch(() => undefined);
    }
    this.started = false;
  }

  private handleFrame(payload: Uint8Array | ArrayBuffer): void {
    if (!this.acceptingFrames) return;

    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
      this.onError?.(new Error("Native audio returned an invalid PCM16 frame."));
      return;
    }

    const pcm16 = decodePcm16(bytes);

    if (this.retainPcm) this.retainedPcm.append(pcm16);
    // Older native helpers still work until the next helper rebuild.
    if (!this.hasLiveLevels) this.onAudioLevel?.(calculatePcm16Level(pcm16));
    this.onPcmFrame?.(pcm16);
  }

  private removeListeners(): void {
    this.acceptingFrames = false;
    if (this.listenersRemoved) return;
    this.listenersRemoved = true;
    this.removeFrameListener();
    this.removeLevelListener?.();
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
  return Math.min(1, Math.sqrt(sumSquares / frame.length) / 32768);
}
