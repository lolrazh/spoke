import type { LocalTranscribeResult } from "../../types/shared";

export interface LocalStreamingDictationOptions {
  modelId: string;
  sampleRateHz: number;
  batchMs?: number;
  maxDurationMs: number;
  onPartial: (text: string) => void;
  onLimitReached: () => void;
}

/**
 * Bounded renderer adapter for a main-process live STT session.
 *
 * Fixed-size batches wait in memory while the pinned model starts. Recording
 * duration bounds that queue. Main-process writes are serialized so IPC
 * backpressure cannot reorder PCM frames.
 */
export class LocalStreamingDictation {
  private readonly batchSamples: number;
  private readonly maxSamples: number;
  private readonly pending: Int16Array[] = [];
  private readonly queuedBatches: Int16Array[] = [];
  private pendingStart = 0;
  private queuedBatchStart = 0;
  private pendingSamples = 0;
  private totalSamples = 0;
  private sessionId: string | null = null;
  private removePartialListener: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private cancelPromise: Promise<void> | null = null;
  private sendQueue = Promise.resolve();
  private failure: Error | null = null;
  private closed = false;
  private startPending = false;
  private cancelRequested = false;
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

  start(): void {
    if (this.closed) {
      throw new Error("Local streaming session was cancelled before startup.");
    }
    if (this.startPromise) {
      throw new Error("Local streaming session is already starting.");
    }
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
    let opening: Promise<{ sessionId: string }>;
    this.startPending = true;
    try {
      opening = bridge.startLocalStream(this.options.modelId);
    } catch (error) {
      this.startPending = false;
      this.cleanupListener();
      throw error;
    }
    this.startPromise = opening
      .then(({ sessionId }) => {
        if (this.cancelRequested) return;
        this.sessionId = sessionId;
        this.drainQueuedBatches();
      })
      .catch((error) => {
        if (!this.cancelRequested) {
          this.failure = asError(error);
        }
        this.cleanupListener();
      })
      .finally(() => {
        this.startPending = false;
      });
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
    while (this.pendingSamples >= this.batchSamples) {
      this.sealPending(this.batchSamples);
    }
  }

  async finish(): Promise<LocalTranscribeResult> {
    if (this.closed) throw new Error("Local streaming session is closed.");
    this.closed = true;
    if (!this.startPromise) {
      throw new Error("Local streaming session did not start.");
    }
    if (this.pendingSamples > 0) this.sealPending(this.pendingSamples);
    await this.startPromise;
    this.drainQueuedBatches();
    await this.sendQueue;
    try {
      if (this.failure) throw this.failure;
      if (!this.sessionId) throw new Error("Local streaming session did not start.");
      return await window.stt.finishLocalStream(this.sessionId);
    } catch (error) {
      try {
        await this.cancel();
      } catch {
        // Preserve the transcription failure that made cancellation necessary.
      }
      throw error;
    } finally {
      this.cleanupListener();
      this.sessionId = null;
    }
  }

  async cancel(): Promise<void> {
    const shouldCancelRemote =
      !this.cancelRequested && (this.startPending || this.sessionId !== null);
    this.cancelRequested = true;
    this.closed = true;
    this.pending.length = 0;
    this.pendingStart = 0;
    this.queuedBatches.length = 0;
    this.queuedBatchStart = 0;
    this.pendingSamples = 0;
    this.cleanupListener();
    this.sessionId = null;
    if (shouldCancelRemote && !this.cancelPromise) {
      this.cancelPromise =
        window.stt?.cancelLocalTranscription?.() ?? Promise.resolve();
    }
    await (this.cancelPromise ?? Promise.resolve());
  }

  private sealPending(sampleCount: number): void {
    if (sampleCount <= 0 || sampleCount > this.pendingSamples) return;
    const pcm = new Int16Array(sampleCount);
    let offset = 0;
    while (offset < sampleCount) {
      const frame = this.pending[this.pendingStart];
      const remaining = sampleCount - offset;
      if (frame.length <= remaining) {
        pcm.set(frame, offset);
        offset += frame.length;
        this.pendingStart += 1;
      } else {
        pcm.set(frame.subarray(0, remaining), offset);
        // Keep the unconsumed tail as a view over the capture frame. The
        // capture frame is already owned by this adapter on the streaming
        // path, so copying the remainder only adds GC pressure.
        this.pending[this.pendingStart] = frame.subarray(remaining);
        offset += remaining;
      }
    }
    if (this.pendingStart === this.pending.length) {
      this.pending.length = 0;
      this.pendingStart = 0;
    } else if (this.pendingStart > 0) {
      this.pending.splice(0, this.pendingStart);
      this.pendingStart = 0;
    }
    this.pendingSamples -= sampleCount;
    this.queuedBatches.push(pcm);
    this.drainQueuedBatches();
  }

  private drainQueuedBatches(): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    while (this.queuedBatchStart < this.queuedBatches.length) {
      const pcm = this.queuedBatches[this.queuedBatchStart];
      this.queuedBatchStart += 1;
      this.sendQueue = this.sendQueue.then(async () => {
        if (this.failure || this.cancelRequested) return;
        try {
          await window.stt.pushLocalStream(sessionId, pcm.buffer as ArrayBuffer);
        } catch (error) {
          this.failure = asError(error);
        }
      });
    }
    this.queuedBatches.length = 0;
    this.queuedBatchStart = 0;
  }

  private cleanupListener(): void {
    this.removePartialListener?.();
    this.removePartialListener = null;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
