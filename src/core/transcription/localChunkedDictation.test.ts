import { describe, expect, it, vi } from "vitest";
import {
  LocalChunkedDictation,
  mergeLocalChunkTexts,
} from "./localChunkedDictation";
import type { CapturedAudio } from "./capturedAudio";
import type { TranscriptionResult } from "./sessionTypes";

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
      minNaturalChunkMs: 800,
      forcedChunkMs: 2_500,
      overlapMs: 100,
      maxDurationMs: 5_000,
      transcribe,
      onLimitReached,
      ...overrides,
    }),
  };
}

describe("LocalChunkedDictation", () => {
  it("seals a natural VAD boundary after the minimum duration", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(80)); // 800ms
    chunker.requestNaturalBoundary();
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0].durationMs).toBe(800);
  });

  it("forces a bounded request and carries only the configured overlap", async () => {
    const { chunker, transcribe } = createChunker();
    chunker.pushFrame(new Int16Array(250)); // 2.5 seconds
    chunker.pushFrame(new Int16Array(250)); // next forced chunk includes 100ms overlap
    await chunker.finish();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[0][0].durationMs).toBe(2500);
    expect(transcribe.mock.calls[1][0].durationMs).toBe(2600);
    expect(chunker.hasDispatchedChunks).toBe(true);
  });

  it("notifies once at the user-facing maximum duration", async () => {
    const { chunker, onLimitReached } = createChunker();
    chunker.pushFrame(new Int16Array(500));
    chunker.pushFrame(new Int16Array(10));
    await chunker.finish();

    expect(onLimitReached).toHaveBeenCalledTimes(1);
    expect(chunker.durationMs).toBe(5100);
  });

  it("removes repeated boundary words from overlapping chunks", () => {
    expect(
      mergeLocalChunkTexts([
        { text: "we should ship this safely" },
        { text: "this safely after the final checks" },
      ]),
    ).toBe("we should ship this safely after the final checks");
  });
});
