import type { LocalTranscribeResult } from "../../types/shared";

export interface LocalStreamingDictationOptions {
  modelId: string;
  sampleRateHz: number;
  batchMs?: number;
  maxDurationMs: number;
  onPartial: (text: string) => void;
  onLimitReached: () => void;
}

const EMPTY_PCM16 = new Int16Array(0);

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
  private readonly queuedBatches: Int16Array[] = [];
  private readonly recycledBatches: Int16Array[] = [];
  private pendingBatch: Int16Array;
  private queuedBatchStart = 0;
  private pendingSamples = 0;
  private totalSamples = 0;
  private sessionId: string | null = null;
  private removePartialListener: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private cancelPromise: Promise<void> | null = null;
  private failure: Error | null = null;
  private closed = false;
  private startPending = false;
  private cancelRequested = false;
  private limitReported = false;
  private sendPumpPromise: Promise<void> | null = null;

  constructor(private readonly options: LocalStreamingDictationOptions) {
    const batchMs = options.batchMs ?? 320;
    this.batchSamples = Math.max(
      1,
      Math.round((batchMs / 1000) * options.sampleRateHz),
    );
    this.maxSamples = Math.round(
      (options.maxDurationMs / 1000) * options.sampleRateHz,
    );
    this.pendingBatch = new Int16Array(this.batchSamples);
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
    let frameOffset = 0;
    while (frameOffset < frame.length) {
      const copyLength = Math.min(
        this.batchSamples - this.pendingSamples,
        frame.length - frameOffset,
      );
      if (frameOffset === 0 && copyLength === frame.length) {
        this.pendingBatch.set(frame, this.pendingSamples);
      } else {
        this.pendingBatch.set(
          frame.subarray(frameOffset, frameOffset + copyLength),
          this.pendingSamples,
        );
      }
      this.pendingSamples += copyLength;
      frameOffset += copyLength;

      if (this.pendingSamples === this.batchSamples) {
        this.queueFullBatch();
      }
    }
  }

  async finish(): Promise<LocalTranscribeResult> {
    if (this.closed) throw new Error("Local streaming session is closed.");
    this.closed = true;
    if (!this.startPromise) {
      throw new Error("Local streaming session did not start.");
    }
    if (this.pendingSamples > 0) {
      const tail = new Int16Array(this.pendingSamples);
      tail.set(this.pendingBatch.subarray(0, this.pendingSamples));
      this.pendingSamples = 0;
      this.queuedBatches.push(tail);
      this.drainQueuedBatches();
    }
    // No more frames can arrive after finish() closes the session. Release the
    // reusable staging buffer while the sidecar drains and finalizes.
    this.pendingBatch = EMPTY_PCM16;
    await this.startPromise;
    this.drainQueuedBatches();
    await this.sendPumpPromise;
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
      this.pendingBatch = EMPTY_PCM16;
      this.recycledBatches.length = 0;
    }
  }

  async cancel(): Promise<void> {
    const shouldCancelRemote =
      !this.cancelRequested && (this.startPending || this.sessionId !== null);
    this.cancelRequested = true;
    this.closed = true;
    this.pendingBatch = EMPTY_PCM16;
    this.queuedBatches.length = 0;
    this.queuedBatchStart = 0;
    this.recycledBatches.length = 0;
    this.pendingSamples = 0;
    this.cleanupListener();
    this.sessionId = null;
    if (shouldCancelRemote && !this.cancelPromise) {
      this.cancelPromise =
        window.stt?.cancelLocalTranscription?.() ?? Promise.resolve();
    }
    await (this.cancelPromise ?? Promise.resolve());
  }

  private queueFullBatch(): void {
    const pcm = this.pendingBatch;
    this.pendingBatch =
      this.recycledBatches.pop() ?? new Int16Array(this.batchSamples);
    this.pendingSamples = 0;
    this.queuedBatches.push(pcm);
    this.drainQueuedBatches();
  }

  private drainQueuedBatches(): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    if (this.sendPumpPromise) return;
    if (this.queuedBatchStart >= this.queuedBatches.length) return;

    this.sendPumpPromise = this.pumpQueuedBatches(sessionId);
  }

  private async pumpQueuedBatches(sessionId: string): Promise<void> {
    while (
      this.queuedBatchStart < this.queuedBatches.length &&
      !this.failure &&
      !this.cancelRequested
    ) {
      const batchIndex = this.queuedBatchStart;
      const pcm = this.queuedBatches[batchIndex];
      // The IPC promise owns the batch after pushLocalStream() starts. Drop
      // the queue's reference now instead of retaining every sent batch until
      // a slow pump becomes idle.
      this.queuedBatches[batchIndex] = EMPTY_PCM16;
      this.queuedBatchStart += 1;
      try {
        await window.stt.pushLocalStream(sessionId, pcm.buffer as ArrayBuffer);
        if (pcm.length === this.batchSamples) {
          // Keep one reusable buffer only. A slow IPC consumer may let the
          // queued list grow; retaining every completed batch would recreate
          // the memory spike this pool is meant to avoid.
          this.recycledBatches[0] = pcm;
        }
      } catch (error) {
        this.failure = asError(error);
      }
    }

    try {
      // Release sent or abandoned buffers as soon as the pump becomes idle.
      this.queuedBatches.length = 0;
      this.queuedBatchStart = 0;
    } finally {
      this.sendPumpPromise = null;
    }
  }

  private cleanupListener(): void {
    this.removePartialListener?.();
    this.removePartialListener = null;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
