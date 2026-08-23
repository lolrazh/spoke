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
      modelId: "nemotron",
      sampleRateHz: 100,
      batchMs: 320,
      maxDurationMs: 5_000,
      onPartial: vi.fn(),
      onLimitReached: vi.fn(),
    });
    await stream.start();
    expect(window.stt.startLocalStream).toHaveBeenCalledWith("nemotron");
    stream.pushFrame(new Int16Array(20).fill(1));
    stream.pushFrame(new Int16Array(20).fill(2));
    stream.pushFrame(new Int16Array(5).fill(3));

    await expect(stream.finish()).resolves.toMatchObject({ text: "final" });
    expect(window.stt.pushLocalStream).toHaveBeenCalledTimes(2);
    expect(window.stt.finishLocalStream).toHaveBeenCalledWith("stream-1");
    const first = new Int16Array(
      (window.stt.pushLocalStream as ReturnType<typeof vi.fn>).mock.calls[0][1],
    );
    expect(first).toHaveLength(32);
    const second = new Int16Array(
      (window.stt.pushLocalStream as ReturnType<typeof vi.fn>).mock.calls[1][1],
    );
    expect(second).toHaveLength(13);
    expect(Array.from(first.slice(18, 22))).toEqual([1, 1, 2, 2]);
  });

  it("forwards only partials for its session", async () => {
    const onPartial = vi.fn();
    const stream = new LocalStreamingDictation({
      modelId: "nemotron",
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

  it("queues bounded batches until model startup completes", async () => {
    let resolveStart!: (value: { sessionId: string }) => void;
    window.stt.startLocalStream = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const stream = new LocalStreamingDictation({
      modelId: "nemotron",
      sampleRateHz: 100,
      batchMs: 320,
      maxDurationMs: 5_000,
      onPartial: vi.fn(),
      onLimitReached: vi.fn(),
    });

    stream.start();
    stream.pushFrame(new Int16Array(20).fill(1));
    stream.pushFrame(new Int16Array(25).fill(2));
    expect(window.stt.pushLocalStream).not.toHaveBeenCalled();

    const finishing = stream.finish();
    resolveStart({ sessionId: "stream-1" });
    await finishing;

    expect(window.stt.pushLocalStream).toHaveBeenCalledTimes(2);
    const batches = (
      window.stt.pushLocalStream as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => new Int16Array(call[1]));
    expect(batches.map((batch) => batch.length)).toEqual([32, 13]);
    expect(Array.from(batches[0].slice(18, 22))).toEqual([1, 1, 2, 2]);
  });

  it("defers a startup failure until finalization", async () => {
    let rejectStart!: (reason: Error) => void;
    window.stt.startLocalStream = vi.fn(
      () =>
        new Promise<{ sessionId: string }>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    const stream = new LocalStreamingDictation({
      modelId: "nemotron",
      sampleRateHz: 100,
      maxDurationMs: 5_000,
      onPartial: vi.fn(),
      onLimitReached: vi.fn(),
    });

    expect(() => stream.start()).not.toThrow();
    stream.pushFrame(new Int16Array(10));
    rejectStart(new Error("model load failed"));

    await expect(stream.finish()).rejects.toThrow("model load failed");
    expect(window.stt.pushLocalStream).not.toHaveBeenCalled();
  });

  it("reports the duration limit once and does not send excess audio", async () => {
    const onLimitReached = vi.fn();
    const stream = new LocalStreamingDictation({
      modelId: "nemotron",
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
