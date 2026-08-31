import {
  createCapturedAudio,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  PCM_CAPTURE_FRAME_SAMPLES,
  TARGET_SAMPLE_RATE_HZ,
} from "../config/audio";
import type { AudioCaptureSession } from "./audioCaptureSession";
import { Pcm16Accumulator } from "./pcm16Accumulator";

export interface PcmCaptureSessionOptions {
  targetSampleRateHz?: number;
  frameSamples?: number;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  /**
   * Called with each raw PCM16 frame as it arrives in real time during
   * capture (same frames later concatenated into the final CapturedAudio at
   * stop()). Used to feed a streaming VAD processor incrementally instead of
   * waiting for the whole clip. Optional and purely additive — omit it and
   * capture behaves exactly as before.
   */
  onPcmFrame?: (frame: Int16Array) => void;
  /** Set false when another consumer drains frames incrementally. */
  retainPcm?: boolean;
  /** Return transferred worklet frames after onPcmFrame consumes them. */
  recyclePcmFrames?: boolean;
}

type WorkletAudioMessage = {
  type: "audio";
  samples: Int16Array;
};

type WorkletFlushedMessage = {
  type: "flushed";
};

type WorkletMessage = WorkletAudioMessage | WorkletFlushedMessage;

const FLUSH_TIMEOUT_MS = 500;
const PCM16_LEVEL_GAIN = 4 / 32768;

export class PcmCaptureSession implements AudioCaptureSession {
  private readonly targetSampleRateHz: number;
  private readonly frameSamples: number;
  private readonly onAudioLevel?: (level: number) => void;
  private readonly onError?: (error: Error) => void;
  private readonly onPcmFrame?: (frame: Int16Array) => void;
  private readonly retainPcm: boolean;
  private readonly recyclePcmFrames: boolean;
  private readonly retainedPcm = new Pcm16Accumulator();
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private flushResolver: (() => void) | null = null;
  private ignoreWorkletAudio = false;
  private stopped = false;

  constructor(options: PcmCaptureSessionOptions = {}) {
    this.targetSampleRateHz =
      options.targetSampleRateHz ?? TARGET_SAMPLE_RATE_HZ;
    this.frameSamples = options.frameSamples ?? PCM_CAPTURE_FRAME_SAMPLES;
    this.onAudioLevel = options.onAudioLevel;
    this.onError = options.onError;
    this.onPcmFrame = options.onPcmFrame;
    this.retainPcm = options.retainPcm ?? true;
    this.recyclePcmFrames = options.recyclePcmFrames ?? false;
  }

  async start(stream?: MediaStream): Promise<void> {
    if (this.audioContext) {
      throw new Error("PCM capture session is already started.");
    }

    this.assertLiveAudioStream(stream);

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio API is unavailable.");
    }

    const audioContext = new AudioContextCtor();
    this.audioContext = audioContext;

    const workletUrl = resolvePcmWorkletUrl();
    await audioContext.audioWorklet.addModule(workletUrl);

    if (this.stopped) {
      await this.cleanup();
      return;
    }

    this.sourceNode = audioContext.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(audioContext, "pcm16-downsampler", {
      processorOptions: {
        targetSampleRate: this.targetSampleRateHz,
        frameSamples: this.frameSamples,
      },
    });

    this.workletNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      this.handleWorkletMessage(event.data);
    };

    this.sourceNode.connect(this.workletNode);
  }

  async stop(): Promise<CapturedAudio> {
    this.stopped = true;
    await this.flush();

    const pcm16 = this.retainedPcm.take();
    await this.cleanup();

    return createCapturedAudio(pcm16, {
      sampleRateHz: this.targetSampleRateHz,
    });
  }

  cancel(): void {
    this.stopped = true;
    this.ignoreWorkletAudio = true;
    this.cleanup().catch((error) => {
      this.onError?.(asError(error));
    });
  }

  private handleWorkletMessage(message: WorkletMessage): void {
    if (message.type === "audio") {
      const frame = message.samples;
      if (this.ignoreWorkletAudio) {
        this.recycleWorkletFrame(frame);
        return;
      }
      if (this.retainPcm) this.retainedPcm.append(frame);
      try {
        this.onAudioLevel?.(calculatePcm16Level(frame));
        this.onPcmFrame?.(frame);
      } finally {
        this.recycleWorkletFrame(frame);
      }
      return;
    }

    if (message.type === "flushed") {
      this.flushResolver?.();
      this.flushResolver = null;
    }
  }

  private async flush(): Promise<void> {
    const workletNode = this.workletNode;
    if (!workletNode) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.ignoreWorkletAudio = true;
        window.clearTimeout(timeout);
        if (this.flushResolver === finish) {
          this.flushResolver = null;
        }
        resolve();
      };

      const timeout = window.setTimeout(finish, FLUSH_TIMEOUT_MS);
      this.flushResolver = finish;
      workletNode.port.postMessage({ type: "flush" });
    });
  }

  private async cleanup(): Promise<void> {
    // Release the retained recording buffer so cancellation does not keep PCM
    // alive past teardown waiting on GC.
    this.retainedPcm.clear();

    if (this.flushResolver) {
      this.flushResolver();
      this.flushResolver = null;
    }

    try {
      this.workletNode?.port.postMessage({ type: "pause" });
    } catch {
      // The node may already be detached.
    }

    try {
      this.sourceNode?.disconnect();
    } catch {
      // Ignore disconnect races during shutdown.
    }

    try {
      this.workletNode?.disconnect();
    } catch {
      // Ignore disconnect races during shutdown.
    }

    const audioContext = this.audioContext;
    this.audioContext = null;
    this.sourceNode = null;
    this.workletNode = null;

    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close();
    }
  }

  private recycleWorkletFrame(frame: Int16Array): void {
    if (!this.recyclePcmFrames || !(frame.buffer instanceof ArrayBuffer)) {
      return;
    }
    if (
      frame.byteOffset !== 0 ||
      frame.byteLength !== frame.buffer.byteLength
    ) {
      return;
    }

    try {
      this.workletNode?.port.postMessage(
        { type: "recycle", samples: frame.buffer },
        [frame.buffer],
      );
    } catch {
      // The worklet may already be detached during cancellation.
    }
  }

  private assertLiveAudioStream(stream?: MediaStream): asserts stream is MediaStream {
    if (!stream) {
      throw new Error("A browser audio stream is required for PCM capture.");
    }
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      throw new Error("MediaStream has no audio tracks.");
    }

    const track = tracks[0];
    if (track.readyState !== "live") {
      throw new Error(`Audio track is not live (state: ${track.readyState}).`);
    }
  }
}

function calculatePcm16Level(frame: Int16Array): number {
  if (frame.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i];
    sumSquares += sample * sample;
  }

  return Math.min(1, Math.sqrt(sumSquares / frame.length) * PCM16_LEVEL_GAIN);
}

function resolvePcmWorkletUrl(): string {
  try {
    const base =
      (import.meta as unknown as { env?: Record<string, unknown> }).env
        ?.BASE_URL ?? "./";
    const rel = `${String(base).replace(/\/$/, "")}/worklets/pcm16-downsampler.worklet.js`;
    return new URL(
      rel,
      typeof window !== "undefined" ? window.location.href : "file://",
    ).toString();
  } catch {
    return "worklets/pcm16-downsampler.worklet.js";
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
