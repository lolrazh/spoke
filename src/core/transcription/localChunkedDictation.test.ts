import { describe, expect, it, vi } from "vitest";
import {
  LocalChunkedDictation,
  mergeLocalChunkTexts,
} from "./localChunkedDictation";
import type { CapturedAudio } from "./capturedAudio";
import type { TranscriptionResult } from "./sessionTypes";

// 100 Hz sample rate: one sample is 10 ms, so durations read as sample/100 s.
function createChunker(
  overrides: Partial<
    ConstructorParameters<typeof LocalChunkedDictation>[0]
  > = {},
) {
  const transcribe = vi.fn<
    (audio: CapturedAudio) => Promise<TranscriptionResult>
  >(async () => ({ text: "chunk" }));
  const onLimitReached = vi.fn();
  return {
    transcribe,
    onLimitReached,
    chunker: new LocalChunkedDictation({
      sampleRateHz: 100,
      minChunkMs: 800,
      maxChunkMs: 2_500,
      pauseGuardMs: 0,
      maxDurationMs: 5_000,
      transcribe,
      onLimitReached,
      ...overrides,
    }),
  };
}

function ramp(length: number, start = 0): Int16Array {
  return Int16Array.from({ length }, (_, index) => start + index);
}

describe("LocalChunkedDictation", () => {
  it("seals at a sentence pause once the chunk is long enough", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(80)); // 800ms
    chunker.noteSpeechEnd(700);
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0].durationMs).toBe(800);
  });

  it("ignores a pause before the minimum chunk length", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(50));
    chunker.noteSpeechEnd(400);
    chunker.noteSpeechStart();
    chunker.pushFrame(new Int16Array(50));
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0].durationMs).toBe(1_000);
  });

  it("transfers an unsubmitted short recording without dispatching a chunk", () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array([1, 2, 3]));

    const audio = chunker.takePendingAudio();

    expect(Array.from(audio.pcm16)).toEqual([1, 2, 3]);
    expect(audio.durationMs).toBe(30);
    expect(transcribe).not.toHaveBeenCalled();
    expect(() => chunker.pushFrame(new Int16Array([4]))).not.toThrow();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("waits through the pause guard and cancels when speech resumes", async () => {
    vi.useFakeTimers();
    try {
      const { chunker, transcribe } = createChunker({ pauseGuardMs: 1_200 });
      chunker.pushFrame(new Int16Array(200));
      chunker.noteSpeechEnd(1_900);

      await vi.advanceTimersByTimeAsync(1_199);
      expect(transcribe).not.toHaveBeenCalled();

      chunker.noteSpeechStart();
      await vi.advanceTimersByTimeAsync(1);
      expect(transcribe).not.toHaveBeenCalled();

      await chunker.finish();
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe.mock.calls[0][0].durationMs).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("seals when the pause guard elapses in silence", async () => {
    vi.useFakeTimers();
    try {
      const { chunker, transcribe } = createChunker({ pauseGuardMs: 1_200 });
      chunker.pushFrame(ramp(100));
      chunker.noteSpeechEnd(900);
      await vi.advanceTimersByTimeAsync(1_200);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe.mock.calls[0][0].durationMs).toBe(1_000);

      // Audio pushed after the seal starts the next chunk from scratch.
      chunker.noteSpeechStart();
      chunker.pushFrame(ramp(100, 100));
      await chunker.finish();
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(Array.from(transcribe.mock.calls[1][0].pcm16.slice(0, 3))).toEqual(
        [100, 101, 102],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cuts an over-long chunk at its most recent breath, never overlapping", async () => {
    const { chunker, transcribe } = createChunker({ pauseGuardMs: 1_200 });
    vi.useFakeTimers();
    try {
      chunker.pushFrame(ramp(200));
      // A short breath at 1.9s: the guard starts, then speech resumes.
      chunker.noteSpeechEnd(1_900);
      chunker.noteSpeechStart();
      chunker.pushFrame(ramp(60, 200)); // crosses the 2.5s maximum
      await chunker.finish();
    } finally {
      vi.useRealTimers();
    }

    expect(transcribe).toHaveBeenCalledTimes(2);
    const [first, second] = transcribe.mock.calls.map(([audio]) => audio);
    expect(first.durationMs).toBe(1_900);
    expect(second.durationMs).toBe(700);
    expect(first.pcm16.at(-1)).toBe(189);
    expect(second.pcm16[0]).toBe(190);
  });

  it("cuts mid-stream only when no pause was detected at all", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.noteSpeechStart();
    chunker.pushFrame(ramp(250));
    chunker.pushFrame(ramp(250, 250));
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[0][0].durationMs).toBe(2_500);
    expect(transcribe.mock.calls[1][0].durationMs).toBe(2_500);
    expect(transcribe.mock.calls[1][0].pcm16[0]).toBe(250);
  });

  it("never dispatches a chunk longer than the maximum", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.noteSpeechStart();
    for (let pushed = 0; pushed < 480; pushed += 96 / 10) {
      chunker.pushFrame(new Int16Array(96 / 10 * 10)); // 96ms frames
    }
    await chunker.finish();

    const durations = transcribe.mock.calls.map(([audio]) => audio.durationMs);
    expect(durations.length).toBeGreaterThan(1);
    expect(Math.max(...durations)).toBeLessThanOrEqual(2_500);
    expect(durations.reduce((sum, ms) => sum + ms, 0)).toBe(
      chunker.durationMs,
    );
  });

  it("ignores a pause too early in the chunk to leave a sane remainder", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(50));
    chunker.noteSpeechEnd(400); // before minChunkMs
    chunker.noteSpeechStart();
    chunker.pushFrame(new Int16Array(200)); // 2.5s total, no usable pause
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0].durationMs).toBe(2_500);
  });

  it("drops a short silent tail instead of transcribing it", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(100));
    chunker.noteSpeechEnd(900);
    chunker.pushFrame(new Int16Array(20)); // 200ms of silence after the seal
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("keeps a short tail that contains speech", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(100));
    chunker.noteSpeechEnd(900);
    chunker.noteSpeechStart();
    chunker.pushFrame(new Int16Array(20));
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[1][0].durationMs).toBe(200);
  });

  it("ignores a late speech end that points into sealed audio", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(100));
    chunker.noteSpeechEnd(900);
    chunker.pushFrame(new Int16Array(100));
    chunker.noteSpeechEnd(950); // stale; already sealed
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[1][0].durationMs).toBe(1_000);
  });

  it("notifies once and rejects audio beyond the maximum duration", async () => {
    const { chunker, onLimitReached, transcribe } = createChunker();
    chunker.noteSpeechStart();
    chunker.pushFrame(new Int16Array(500));
    chunker.pushFrame(new Int16Array(10));
    await chunker.finish();

    expect(onLimitReached).toHaveBeenCalledTimes(1);
    expect(chunker.durationMs).toBe(5000);
    expect(
      transcribe.mock.calls.reduce(
        (durationMs, [audio]) => durationMs + audio.durationMs,
        0,
      ),
    ).toBe(5000);
  });
});

describe("mergeLocalChunkTexts", () => {
  it("joins chunks with a space and skips empty ones", () => {
    expect(
      mergeLocalChunkTexts([
        { text: "We should ship this safely." },
        { text: "  " },
        { text: "After the final checks." },
      ]),
    ).toBe("We should ship this safely. After the final checks.");
  });

  it("lowercases a chunk that resumes an open sentence", () => {
    expect(
      mergeLocalChunkTexts([
        { text: "If it wants to understand the engine" },
        { text: "And you know make any improvements it can." },
      ]),
    ).toBe(
      "If it wants to understand the engine and you know make any improvements it can.",
    );
  });

  it("keeps the case of I, contractions of I, and acronyms at a seam", () => {
    expect(
      mergeLocalChunkTexts([{ text: "so then" }, { text: "I'll do it" }]),
    ).toBe("so then I'll do it");
    expect(
      mergeLocalChunkTexts([{ text: "so then" }, { text: "I did it" }]),
    ).toBe("so then I did it");
    expect(
      mergeLocalChunkTexts([{ text: "use the" }, { text: "API for that" }]),
    ).toBe("use the API for that");
  });

  it("leaves a chunk alone after a closed sentence", () => {
    expect(
      mergeLocalChunkTexts([
        { text: 'She said "done."' },
        { text: "Then we left." },
      ]),
    ).toBe('She said "done." Then we left.');
    expect(
      mergeLocalChunkTexts([{ text: "Really?" }, { text: "Yes." }]),
    ).toBe("Really? Yes.");
  });
});
