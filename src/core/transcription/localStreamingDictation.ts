import type { LocalTranscribeResult } from "../../types/shared";

export interface LocalStreamingDictationOptions {
  sampleRateHz: number;
  batchMs?: number;
  maxDurationMs: number;
  onPartial: (text: string) => void;
  onLimitReached: () => void;
}

/**
 * Bounded renderer adapter for a main-process live STT session.
 *
 * Only one send batch is retained. Main-process writes are serialized so IPC
 * backpressure cannot reorder PCM frames.
 */
export class LocalStreamingDictation {
  private readonly batchSamples: number;
  private readonly maxSamples: number;
  private readonly pending: Int16Array[] = [];
  private pendingSamples = 0;
  private totalSamples = 0;
  private sessionId: string | null = null;
  private removePartialListener: (() => void) | null = null;
  private sendQueue = Promise.resolve();
  private failure: Error | null = null;
  private closed = false;
  private limitReported = false;

  constructor(private readonly options: LocalStreamingDictationOptions) {
    const batchMs = options.batchMs ?? 320;
    this.batchSamples = Math.max(
      1,
      Math.round((batchMs / 1000) * options.sampleRateHz),
    );
    this.maxSamples = Math.round(
      (options.maxDurationMs / 1000) * options.sampleRateHz,
    );
  }

  get durationMs(): number {
    return (this.totalSamples / this.options.sampleRateHz) * 1000;
  }

  async start(): Promise<void> {
    const bridge = window.stt;
    if (
      !bridge?.startLocalStream ||
      !bridge.pushLocalStream ||
      !bridge.finishLocalStream ||
      !bridge.onLocalStreamPartial
    ) {
      throw new Error("Local streaming bridge is unavailable.");
    }
    this.removePartialListener = bridge.onLocalStreamPartial((payload) => {
      if (payload.sessionId === this.sessionId) {
        this.options.onPartial(payload.text);
      }
    });
    try {
      const { sessionId } = await bridge.startLocalStream();
      this.sessionId = sessionId;
    } catch (error) {
      this.cleanupListener();
      throw error;
    }
  }

  pushFrame(frame: Int16Array): void {
    if (this.closed || frame.length === 0 || this.limitReported) return;
    if (this.totalSamples + frame.length > this.maxSamples) {
      this.limitReported = true;
      this.options.onLimitReached();
      return;
    }
    this.totalSamples += frame.length;
    this.pending.push(frame);
    this.pendingSamples += frame.length;
    if (this.pendingSamples >= this.batchSamples) this.flushPending();
  }

  async finish(): Promise<LocalTranscribeResult> {
    if (this.closed) throw new Error("Local streaming session is closed.");
    this.closed = true;
    this.flushPending();
    await this.sendQueue;
    try {
      if (this.failure) throw this.failure;
      if (!this.sessionId) throw new Error("Local streaming session did not start.");
      return await window.stt.finishLocalStream(this.sessionId);
    } catch (error) {
      void window.stt?.cancelLocalTranscription?.();
      throw error;
    } finally {
      this.cleanupListener();
      this.sessionId = null;
    }
  }

  cancel(): void {
    const hadSession = this.sessionId !== null;
    this.closed = true;
    this.pending.length = 0;
    this.pendingSamples = 0;
    this.cleanupListener();
    this.sessionId = null;
    if (hadSession) void window.stt?.cancelLocalTranscription?.();
  }

  private flushPending(): void {
    if (this.pendingSamples === 0) return;
    const pcm = new Int16Array(this.pendingSamples);
    let offset = 0;
    for (const frame of this.pending) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    this.pending.length = 0;
    this.pendingSamples = 0;
    const sessionId = this.sessionId;
    if (!sessionId) {
      this.failure = new Error("Local streaming session is not active.");
      return;
    }
    this.sendQueue = this.sendQueue.then(async () => {
      if (this.failure) return;
      try {
        await window.stt.pushLocalStream(sessionId, pcm.buffer);
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
      }
    });
  }

  private cleanupListener(): void {
    this.removePartialListener?.();
    this.removePartialListener = null;
  }
}
