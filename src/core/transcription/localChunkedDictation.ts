import {
  createCapturedAudio,
  type CapturedAudio,
} from "./capturedAudio";
import type { TranscriptionResult } from "./sessionTypes";
import { Pcm16Accumulator } from "../../utils/pcm16Accumulator";

export interface LocalChunkedDictationOptions {
  sampleRateHz: number;
  /** Shortest chunk a sentence pause may close. Shorter recordings stay single-shot. */
  minChunkMs: number;
  /** Longest chunk before the pending audio is cut at its most recent pause. */
  maxChunkMs: number;
  /** Silence that must follow a VAD speech end before it counts as a sentence pause. */
  pauseGuardMs?: number;
  maxDurationMs: number;
  transcribe: (audio: CapturedAudio) => Promise<TranscriptionResult>;
  onLimitReached: () => void;
}

// A tail shorter than this with no detected speech is silence or a breath;
// sending it only invites a hallucinated word.
const MIN_UNVOICED_TAIL_MS = 500;

/**
 * Cuts a long dictation into bounded sidecar requests at points where the
 * speaker is silent, so no audio is ever transcribed twice and no word is
 * split across two requests.
 *
 * - A sentence pause (VAD speech end followed by `pauseGuardMs` of silence)
 *   closes the pending audio once it is at least `minChunkMs` long.
 * - If the speaker never pauses that long, the pending audio is cut at its
 *   most recent VAD speech end once it reaches `maxChunkMs`. Only a speaker
 *   who produces no detectable gap at all is cut mid-stream.
 */
export class LocalChunkedDictation {
  private readonly pendingPcm = new Pcm16Accumulator();
  private readonly chunkTasks: Promise<
    { result: TranscriptionResult } | { error: unknown }
  >[] = [];
  private totalSamples = 0;
  /** Absolute sample index where the pending audio begins. */
  private sealedSamples = 0;
  /** Absolute sample index of the latest VAD speech end inside pending audio. */
  private lastSpeechEndSample: number | null = null;
  private speaking = false;
  private speechInPending = false;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private limitReached = false;
  private finished = false;
  private dispatchedChunkCount = 0;
  private readonly maxSamples: number;
  private readonly minChunkSamples: number;
  private readonly maxChunkSamples: number;
  private readonly minUnvoicedTailSamples: number;

  constructor(private readonly options: LocalChunkedDictationOptions) {
    const samplesPerMs = options.sampleRateHz / 1000;
    this.maxSamples = Math.round(options.maxDurationMs * samplesPerMs);
    this.minChunkSamples = Math.ceil(options.minChunkMs * samplesPerMs);
    this.maxChunkSamples = Math.ceil(options.maxChunkMs * samplesPerMs);
    this.minUnvoicedTailSamples = Math.ceil(
      MIN_UNVOICED_TAIL_MS * samplesPerMs,
    );
  }

  pushFrame(frame: Int16Array): void {
    if (this.finished || frame.length === 0) return;

    const remainingSamples = this.maxSamples - this.totalSamples;
    if (remainingSamples <= 0) return;

    const acceptedFrame =
      frame.length <= remainingSamples
        ? frame
        : frame.subarray(0, remainingSamples);
    // Never let a chunk grow past the maximum: cut before this frame lands.
    if (this.pendingSamples + acceptedFrame.length > this.maxChunkSamples) {
      this.sealAtLastPause();
    }
    this.pendingPcm.append(acceptedFrame);
    this.totalSamples += acceptedFrame.length;

    if (!this.limitReached && this.totalSamples >= this.maxSamples) {
      this.limitReached = true;
      this.options.onLimitReached();
    }

    if (this.pendingSamples >= this.maxChunkSamples) {
      this.sealAtLastPause();
    }
  }

  /** Called by streaming VAD when speech resumes after a pause. */
  noteSpeechStart(): void {
    this.speaking = true;
    this.speechInPending = true;
    this.clearPauseTimer();
  }

  /** Called by streaming VAD once a speech segment ended at `endMs`. */
  noteSpeechEnd(endMs: number): void {
    if (this.finished) return;
    this.speaking = false;

    const endSample = Math.min(
      this.totalSamples,
      Math.round((endMs * this.options.sampleRateHz) / 1000),
    );
    // A late event for audio that was already sealed carries no boundary.
    if (endSample <= this.sealedSamples) return;
    this.lastSpeechEndSample = endSample;

    if (this.pendingSamples < this.minChunkSamples) return;
    this.clearPauseTimer();
    const guardMs = this.options.pauseGuardMs ?? 0;
    if (guardMs <= 0) {
      this.seal(this.pendingSamples);
      return;
    }
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      if (!this.finished && this.pendingSamples >= this.minChunkSamples) {
        this.seal(this.pendingSamples);
      }
    }, guardMs);
  }

  /** Stop future chunk dispatches when the caller is using single-shot audio. */
  discardPendingAudio(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearPauseTimer();
    this.pendingPcm.clear();
    this.sealedSamples = this.totalSamples;
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
    this.clearPauseTimer();
    this.sealedSamples = this.totalSamples;

    return createCapturedAudio(this.pendingPcm.take(), {
      sampleRateHz: this.options.sampleRateHz,
    });
  }

  async finish(): Promise<TranscriptionResult[]> {
    if (!this.finished) {
      this.finished = true;
      this.clearPauseTimer();
      const tail = this.pendingSamples;
      if (
        tail > 0 &&
        (this.speechInPending || this.speaking || tail >= this.minUnvoicedTailSamples)
      ) {
        this.seal(tail);
      } else {
        this.pendingPcm.clear();
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

  private get pendingSamples(): number {
    return this.totalSamples - this.sealedSamples;
  }

  /** The pending audio hit its cap without a sentence pause; cut at the last gap. */
  private sealAtLastPause(): void {
    const cutSample =
      this.lastSpeechEndSample !== null
        ? this.lastSpeechEndSample - this.sealedSamples
        : 0;
    // A gap early in the chunk would leave an oversized remainder, which
    // would only be cut mid-stream a moment later. Prefer one clean cut now.
    const usable = cutSample >= this.minChunkSamples;
    this.seal(usable ? cutSample : this.pendingSamples);
  }

  private seal(chunkSamples: number): void {
    if (chunkSamples <= 0) return;

    this.clearPauseTimer();
    const pending = this.pendingPcm.take();
    const chunk =
      chunkSamples >= pending.length ? pending : pending.subarray(0, chunkSamples);
    if (chunkSamples < pending.length) {
      // The remainder starts the next chunk. Copy it into fresh storage so the
      // sealed chunk's buffer is released once its request completes.
      this.pendingPcm.append(pending.subarray(chunkSamples));
    }
    this.sealedSamples += chunk.length;
    this.lastSpeechEndSample = null;
    // Speech in progress at the cut continues into the remainder.
    this.speechInPending = this.speaking;

    const audio = createCapturedAudio(chunk, {
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

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }
}

const SENTENCE_END_RE = /[.!?…]["'”’)\]]*$/;
// "I", "I'm", "I'll"... or a token with a second capital (an acronym) keeps
// its case; anything else starting a chunk mid-sentence is a plain word.
const KEEP_CASE_RE = /^(?:I(?=$|[^\p{L}])|\S*\p{Lu}\S*\p{Lu})/u;

/**
 * Join chunk texts. Chunks never share audio, so there is nothing to dedupe;
 * the only seam work is lowercasing a chunk that resumes a sentence the
 * previous chunk left open, since a fresh request always starts with a capital.
 */
export function mergeLocalChunkTexts(
  results: readonly TranscriptionResult[],
): string {
  let merged = "";
  for (const result of results) {
    let text = result.text.trim();
    if (text.length === 0) continue;
    if (merged.length > 0 && !SENTENCE_END_RE.test(merged)) {
      text = lowercaseContinuation(text);
    }
    merged = merged.length === 0 ? text : `${merged} ${text}`;
  }
  return merged;
}

function lowercaseContinuation(text: string): string {
  const firstWord = text.split(/\s+/, 1)[0];
  if (KEEP_CASE_RE.test(firstWord)) return text;
  return text[0].toLowerCase() + text.slice(1);
}
