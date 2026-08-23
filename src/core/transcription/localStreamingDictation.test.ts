import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStreamingDictation } from "./localStreamingDictation";

describe("LocalStreamingDictation", () => {
  let partialListener: ((payload: { sessionId: string; text: string }) => void) | null;

  beforeEach(() => {
    partialListener = null;
    Object.assign(window.stt, {
      startLocalStream: vi.fn(async () => ({ sessionId: "stream-1" })),
      pushLocalStream: vi.fn(async () => undefined),
      finishLocalStream: vi.fn(async () => ({ text: "final", metrics: {} })),
      cancelLocalTranscription: vi.fn(async () => undefined),
      onLocalStreamPartial: vi.fn((listener) => {
        partialListener = listener;
        return vi.fn();
      }),
    });
  });

  it("batches PCM in order and flushes the tail before finalization", async () => {
    const stream = new LocalStreamingDictation({
      sampleRateHz: 100,
      batchMs: 320,
      maxDurationMs: 5_000,
      onPartial: vi.fn(),
      onLimitReached: vi.fn(),
    });
    await stream.start();
    stream.pushFrame(new Int16Array(20).fill(1));
    stream.pushFrame(new Int16Array(20).fill(2));
    stream.pushFrame(new Int16Array(5).fill(3));

    await expect(stream.finish()).resolves.toMatchObject({ text: "final" });
    expect(window.stt.pushLocalStream).toHaveBeenCalledTimes(2);
    expect(window.stt.finishLocalStream).toHaveBeenCalledWith("stream-1");
    const first = new Int16Array(
      (window.stt.pushLocalStream as ReturnType<typeof vi.fn>).mock.calls[0][1],
    );
    expect(first).toHaveLength(40);
    expect(Array.from(first.slice(18, 22))).toEqual([1, 1, 2, 2]);
  });

  it("forwards only partials for its session", async () => {
    const onPartial = vi.fn();
    const stream = new LocalStreamingDictation({
      sampleRateHz: 100,
      maxDurationMs: 5_000,
      onPartial,
      onLimitReached: vi.fn(),
    });
    await stream.start();
    partialListener?.({ sessionId: "old", text: "stale" });
    partialListener?.({ sessionId: "stream-1", text: "hello" });
    expect(onPartial).toHaveBeenCalledOnce();
    expect(onPartial).toHaveBeenCalledWith("hello");
    stream.cancel();
  });

  it("reports the duration limit once and does not send excess audio", async () => {
    const onLimitReached = vi.fn();
    const stream = new LocalStreamingDictation({
      sampleRateHz: 100,
      batchMs: 1_000,
      maxDurationMs: 1_000,
      onPartial: vi.fn(),
      onLimitReached,
    });
    await stream.start();
    stream.pushFrame(new Int16Array(100));
    stream.pushFrame(new Int16Array(1));
    stream.pushFrame(new Int16Array(1));
    await stream.finish();

    expect(onLimitReached).toHaveBeenCalledOnce();
    expect(stream.durationMs).toBe(1_000);
    expect(window.stt.pushLocalStream).toHaveBeenCalledTimes(1);
  });
});
