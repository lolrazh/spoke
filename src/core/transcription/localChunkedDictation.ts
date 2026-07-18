import {
  concatPcm16,
  createCapturedAudio,
  type CapturedAudio,
} from "./capturedAudio";
import type { TranscriptionResult } from "./sessionTypes";

export interface LocalChunkedDictationOptions {
  sampleRateHz: number;
  minNaturalChunkMs: number;
  forcedChunkMs: number;
  overlapMs: number;
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
  private readonly chunks: Int16Array[] = [];
  private readonly chunkTasks: Promise<
    { result: TranscriptionResult } | { error: unknown }
  >[] = [];
  private pendingSamples = 0;
  private freshSamples = 0;
  private totalSamples = 0;
  private naturalBoundaryRequested = false;
  private limitReached = false;
  private finished = false;
  private dispatchedChunkCount = 0;

  constructor(private readonly options: LocalChunkedDictationOptions) {}

  pushFrame(frame: Int16Array): void {
    if (this.finished || frame.length === 0) return;

    this.chunks.push(frame);
    this.pendingSamples += frame.length;
    this.freshSamples += frame.length;
    this.totalSamples += frame.length;

    if (
      !this.limitReached &&
      this.totalDurationMs() >= this.options.maxDurationMs
    ) {
      this.limitReached = true;
      this.options.onLimitReached();
    }

    if (this.pendingDurationMs() >= this.options.forcedChunkMs) {
      this.seal();
    } else if (
      this.naturalBoundaryRequested &&
      this.pendingDurationMs() >= this.options.minNaturalChunkMs
    ) {
      this.seal();
    }
  }

  /** Called by streaming VAD after it confirms a speech segment ended. */
  requestNaturalBoundary(): void {
    if (this.finished) return;
    this.naturalBoundaryRequested = true;
    if (this.pendingDurationMs() >= this.options.minNaturalChunkMs) {
      this.seal();
    }
  }

  async finish(): Promise<TranscriptionResult[]> {
    if (!this.finished) {
      this.finished = true;
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
    return this.totalDurationMs();
  }

  /** Whether recording has already moved onto the bounded streaming path. */
  get hasDispatchedChunks(): boolean {
    return this.dispatchedChunkCount > 0;
  }

  private seal(): void {
    if (this.freshSamples === 0) return;

    const pcm16 = concatPcm16(this.chunks);
    const overlapSamples = Math.min(
      pcm16.length,
      Math.round((this.options.overlapMs * this.options.sampleRateHz) / 1000),
    );
    const overlap = overlapSamples > 0 ? pcm16.slice(-overlapSamples) : null;
    this.chunks.length = 0;
    if (overlap && overlap.length > 0) this.chunks.push(overlap);
    this.pendingSamples = overlap?.length ?? 0;
    this.freshSamples = 0;
    this.naturalBoundaryRequested = false;

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

  private pendingDurationMs(): number {
    return (this.pendingSamples / this.options.sampleRateHz) * 1000;
  }

  private totalDurationMs(): number {
    return (this.totalSamples / this.options.sampleRateHz) * 1000;
  }
}

/** Join chunk results without repeating words generated from the overlap. */
export function mergeLocalChunkTexts(
  results: readonly TranscriptionResult[],
): string {
  let merged: string[] = [];
  for (const result of results) {
    const next = result.text.trim().split(/\s+/).filter(Boolean);
    if (next.length === 0) continue;
    const maxOverlap = Math.min(12, merged.length, next.length);
    let overlap = 0;
    for (let size = maxOverlap; size > 0; size--) {
      const previousTail = merged.slice(-size).map(normalizeWord);
      const nextHead = next.slice(0, size).map(normalizeWord);
      if (previousTail.every((word, index) => word === nextHead[index])) {
        overlap = size;
        break;
      }
    }
    merged = merged.concat(next.slice(overlap));
  }
  return merged.join(" ");
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^\p{P}+|\p{P}+$/gu, "");
}
