import {
  createCapturedAudio,
  concatPcm16,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  PCM_CAPTURE_FRAME_SAMPLES,
  TARGET_SAMPLE_RATE_HZ,
} from "../config/audio";

export interface PcmCaptureSessionOptions {
  targetSampleRateHz?: number;
  frameSamples?: number;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
}

type WorkletAudioMessage = {
  type: "audio";
  samples: ArrayBuffer;
  rate: number;
  seq: number;
};

type WorkletFlushedMessage = {
  type: "flushed";
  rate: number;
  seq: number;
};

type WorkletMessage = WorkletAudioMessage | WorkletFlushedMessage;

const FLUSH_TIMEOUT_MS = 500;

export class PcmCaptureSession {
  private readonly targetSampleRateHz: number;
  private readonly frameSamples: number;
  private readonly onAudioLevel?: (level: number) => void;
  private readonly onError?: (error: Error) => void;
  private readonly chunks: Int16Array[] = [];
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private flushResolver: (() => void) | null = null;
  private stopped = false;

  constructor(options: PcmCaptureSessionOptions = {}) {
    this.targetSampleRateHz =
      options.targetSampleRateHz ?? TARGET_SAMPLE_RATE_HZ;
    this.frameSamples = options.frameSamples ?? PCM_CAPTURE_FRAME_SAMPLES;
    this.onAudioLevel = options.onAudioLevel;
    this.onError = options.onError;
  }

  async start(stream: MediaStream): Promise<void> {
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

    const pcm16 = concatPcm16(this.chunks);
    await this.cleanup();

    return createCapturedAudio(pcm16, {
      sampleRateHz: this.targetSampleRateHz,
    });
  }

  cancel(): void {
    this.stopped = true;
    this.cleanup().catch((error) => {
      this.onError?.(asError(error));
    });
  }

  private handleWorkletMessage(message: WorkletMessage): void {
    if (message.type === "audio") {
      const frame = new Int16Array(message.samples);
      this.chunks.push(frame);
      this.onAudioLevel?.(calculatePcm16Level(frame));
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

  private assertLiveAudioStream(stream: MediaStream): void {
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

export function calculatePcm16Level(frame: Int16Array): number {
  if (frame.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    const normalized = frame[i] / 32768;
    sumSquares += normalized * normalized;
  }

  return Math.min(1, Math.sqrt(sumSquares / frame.length) * 4);
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
