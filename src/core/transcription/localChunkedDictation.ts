import {
  createCapturedAudio,
  type CapturedAudio,
} from "./capturedAudio";
import type { TranscriptionResult } from "./sessionTypes";
import { Pcm16Accumulator } from "../../utils/pcm16Accumulator";

export interface LocalChunkedDictationOptions {
  sampleRateHz: number;
  minNaturalChunkMs: number;
  naturalChunkingStartMs?: number;
  forcedChunkMs: number;
  overlapMs: number;
  naturalBoundaryDelayMs?: number;
  maxDurationMs: number;
  transcribe: (audio: CapturedAudio) => Promise<TranscriptionResult>;
  onLimitReached: () => void;
}

/**
 * Holds only the current local-STT request while recording. Completed chunks
 * are immediately handed to the caller, so a long dictation never becomes one
 * enormous renderer buffer or one unbounded sidecar inference.
 */
export class LocalChunkedDictation {
  private readonly pendingPcm = new Pcm16Accumulator();
  private readonly chunkTasks: Promise<
    { result: TranscriptionResult } | { error: unknown }
  >[] = [];
  private pendingSamples = 0;
  private freshSamples = 0;
  private totalSamples = 0;
  private naturalBoundaryRequested = false;
  private naturalBoundaryReady = false;
  private naturalBoundaryTimer: ReturnType<typeof setTimeout> | null = null;
  private limitReached = false;
  private finished = false;
  private dispatchedChunkCount = 0;
  private readonly maxSamples: number;
  private readonly minNaturalChunkSamples: number;
  private readonly naturalChunkingStartSamples: number;
  private readonly forcedChunkSamples: number;

  constructor(private readonly options: LocalChunkedDictationOptions) {
    const samplesPerMs = options.sampleRateHz / 1000;
    this.maxSamples = Math.round(
      (options.maxDurationMs * options.sampleRateHz) / 1000,
    );
    this.minNaturalChunkSamples = Math.ceil(
      options.minNaturalChunkMs * samplesPerMs,
    );
    this.naturalChunkingStartSamples = Math.ceil(
      (options.naturalChunkingStartMs ?? 0) * samplesPerMs,
    );
    this.forcedChunkSamples = Math.ceil(
      options.forcedChunkMs * samplesPerMs,
    );
  }

  pushFrame(frame: Int16Array): void {
    if (this.finished || frame.length === 0) return;

    const remainingSamples = this.maxSamples - this.totalSamples;
    if (remainingSamples <= 0) return;

    const acceptedFrame =
      frame.length <= remainingSamples
        ? frame
        : frame.slice(0, remainingSamples);
    this.pendingPcm.append(acceptedFrame);
    this.pendingSamples += acceptedFrame.length;
    this.freshSamples += acceptedFrame.length;
    this.totalSamples += acceptedFrame.length;

    if (!this.limitReached && this.totalSamples >= this.maxSamples) {
      this.limitReached = true;
      this.options.onLimitReached();
    }

    if (this.pendingSamples >= this.forcedChunkSamples) {
      this.seal();
    } else if (
      this.naturalBoundaryReady &&
      this.pendingSamples >= this.minNaturalChunkSamples
    ) {
      this.seal();
    }
  }

  /** Called by streaming VAD after it confirms a speech segment ended. */
  requestNaturalBoundary(): void {
    if (
      this.finished ||
      this.totalSamples < this.naturalChunkingStartSamples
    ) {
      return;
    }

    if (this.naturalBoundaryRequested) return;
    this.naturalBoundaryRequested = true;

    const delayMs = this.options.naturalBoundaryDelayMs ?? 0;
    if (delayMs <= 0) {
      this.naturalBoundaryReady = true;
      this.trySealNaturalBoundary();
      return;
    }

    this.naturalBoundaryTimer = setTimeout(() => {
      this.naturalBoundaryTimer = null;
      this.naturalBoundaryReady = true;
      this.trySealNaturalBoundary();
    }, delayMs);
  }

  /** Called by streaming VAD when speech resumes during the pause guard. */
  cancelNaturalBoundary(): void {
    this.clearNaturalBoundaryTimer();
    this.naturalBoundaryRequested = false;
    this.naturalBoundaryReady = false;
  }

  /** Stop future chunk dispatches when the caller is using single-shot audio. */
  discardPendingAudio(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearNaturalBoundaryTimer();
    this.naturalBoundaryRequested = false;
    this.naturalBoundaryReady = false;
    this.pendingPcm.clear();
    this.pendingSamples = 0;
    this.freshSamples = 0;
  }

  /**
   * Transfer audio that was never sealed into a bounded request. This keeps a
   * short recording on the normal post-hoc VAD path without making the capture
   * session retain a second copy of the same frames.
   */
  takePendingAudio(): CapturedAudio {
    if (this.dispatchedChunkCount > 0) {
      throw new Error("Cannot take audio after local chunks were dispatched.");
    }

    this.finished = true;
    this.clearNaturalBoundaryTimer();
    this.naturalBoundaryRequested = false;
    this.naturalBoundaryReady = false;
    this.pendingSamples = 0;
    this.freshSamples = 0;

    return createCapturedAudio(this.pendingPcm.take(), {
      sampleRateHz: this.options.sampleRateHz,
    });
  }

  async finish(): Promise<TranscriptionResult[]> {
    if (!this.finished) {
      this.finished = true;
      this.clearNaturalBoundaryTimer();
      if (this.freshSamples > 0) {
        this.seal();
      }
    }
    const settled = await Promise.all(this.chunkTasks);
    const failed = settled.find(
      (item): item is { error: unknown } => "error" in item,
    );
    if (failed) throw failed.error;
    return settled.map(
      (item) => (item as { result: TranscriptionResult }).result,
    );
  }

  get durationMs(): number {
    return (this.totalSamples / this.options.sampleRateHz) * 1000;
  }

  /** Whether recording has already moved onto the bounded streaming path. */
  get hasDispatchedChunks(): boolean {
    return this.dispatchedChunkCount > 0;
  }

  private seal(): void {
    if (this.freshSamples === 0) return;

    this.clearNaturalBoundaryTimer();
    const pcm16 = this.pendingPcm.take();
    const overlapSamples = Math.min(
      pcm16.length,
      Math.round((this.options.overlapMs * this.options.sampleRateHz) / 1000),
    );
    // Keep the overlap as a view. The next accumulator copies it into its own
    // storage, so allocating a separate sliced buffer here only adds one
    // temporary allocation and copy per sealed chunk.
    const overlap =
      overlapSamples > 0 ? pcm16.subarray(-overlapSamples) : null;
    if (overlap && overlap.length > 0) this.pendingPcm.append(overlap);
    this.pendingSamples = overlap?.length ?? 0;
    this.freshSamples = 0;
    this.naturalBoundaryRequested = false;
    this.naturalBoundaryReady = false;

    const audio = createCapturedAudio(pcm16, {
      sampleRateHz: this.options.sampleRateHz,
    });
    this.dispatchedChunkCount += 1;
    // Start immediately. The main process owns serialization because it owns
    // the sidecar stdout stream; keeping another queue here would retain later
    // PCM capture buffers while an earlier inference is still running.
    this.chunkTasks.push(
      this.options.transcribe(audio).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      ),
    );
  }

  private trySealNaturalBoundary(): void {
    if (
      !this.finished &&
      this.naturalBoundaryReady &&
      this.pendingSamples >= this.minNaturalChunkSamples
    ) {
      this.seal();
    }
  }

  private clearNaturalBoundaryTimer(): void {
    if (this.naturalBoundaryTimer !== null) {
      clearTimeout(this.naturalBoundaryTimer);
      this.naturalBoundaryTimer = null;
    }
  }

}

/** Join chunk results without repeating words generated from the overlap. */
export function mergeLocalChunkTexts(
  results: readonly TranscriptionResult[],
): string {
  const merged: string[] = [];
  for (const result of results) {
    const trimmed = result.text.trim();
    if (trimmed.length === 0) continue;
    const next = trimmed.split(/\s+/);
    const maxOverlap = Math.min(12, merged.length, next.length);
    let overlap = 0;
    for (let size = maxOverlap; size > 0; size--) {
      let matches = true;
      for (let index = 0; index < size; index++) {
        const previousWord = normalizeWord(merged[merged.length - size + index]);
        if (previousWord !== normalizeWord(next[index])) {
          matches = false;
          break;
        }
      }
      if (matches) {
        overlap = size;
        break;
      }
    }
    for (let index = overlap; index < next.length; index++) {
      merged.push(next[index]);
    }
  }
  return merged.join(" ");
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^\p{P}+|\p{P}+$/gu, "");
}
