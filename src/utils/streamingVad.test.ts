import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Message } from "@ricky0123/vad-web";
import { createStreamingVadSession } from "./streamingVad";
import type { VadWorkerClient } from "./vadWorkerClient";
import type {
  VadWorkerEvent,
  VadWorkerProcessResult,
} from "./vadWorkerProtocol";
import {
  createCapturedAudio,
  pcm16ToFloat32,
} from "../core/transcription/capturedAudio";
import {
  trimCapturedAudioToSpeech,
  type VadSpeechSegment,
} from "../core/transcription/vadTrim";
import { VAD_PRE_SPEECH_PAD_MS, VAD_REDEMPTION_MS } from "../config/vad";
import {
  createScriptedFrameProcessor,
  createScriptedNonRealTimeVad,
  FAKE_VAD_MODEL_FRAME_SAMPLES,
} from "../test/fakes/fakeVadModel";

const mocks = vi.hoisted(() => ({
  createVadWorkerClient: vi.fn(),
}));

vi.mock("./vadWorkerClient", () => ({
  createVadWorkerClient: mocks.createVadWorkerClient,
}));

type FakeEvent =
  | { msg: Message.SpeechStart }
  | { msg: Message.SpeechEnd; audio: Float32Array }
  | { msg: Message.VADMisfire }
  | { msg: Message.FrameProcessed; probs: { isSpeech: number; notSpeech: number }; frame: Float32Array };

type ProcessImpl = (
  frame: Float32Array,
  handleEvent: (event: FakeEvent) => void,
) => Promise<void> | void;

function createManualFrameProcessor(processImpl?: ProcessImpl) {
  const process = vi.fn(
    processImpl ??
      (async (frame: Float32Array, handleEvent: (event: FakeEvent) => void) => {
        handleEvent({
          msg: Message.FrameProcessed,
          probs: { isSpeech: 0, notSpeech: 1 },
          frame,
        });
      }),
  );
  return {
    reset: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    setOptions: vi.fn(),
    process,
    endSegment: vi.fn((_handleEvent: (event: FakeEvent) => void) => ({})),
  };
}

function createWorkerForFrameProcessor(
  frameProcessor: ReturnType<typeof createManualFrameProcessor>,
): VadWorkerClient {
  return {
    ready: vi.fn().mockResolvedValue(undefined),
    processFrame: vi.fn(async (frame: Float32Array, frameIndex: number) => {
      const events: Array<{
        type: "speech-start" | "speech-end" | "misfire";
        frameIndex: number;
      }> = [];
      await frameProcessor.process(frame, (event) => {
        if (event.msg === Message.SpeechStart) {
          events.push({ type: "speech-start", frameIndex });
        } else if (event.msg === Message.SpeechEnd) {
          events.push({ type: "speech-end", frameIndex });
        } else if (event.msg === Message.VADMisfire) {
          events.push({ type: "misfire", frameIndex });
        }
      });
      return {
        events,
        frame,
      } satisfies VadWorkerProcessResult;
    }),
    finish: vi.fn(async (frameIndex: number) => {
      const events: Array<{
        type: "speech-start" | "speech-end" | "misfire";
        frameIndex: number;
      }> = [];
      frameProcessor.endSegment((event) => {
        if (event.msg === Message.SpeechEnd) {
          events.push({ type: "speech-end", frameIndex });
        }
      });
      return events;
    }),
    runClip: vi.fn(),
    dispose: vi.fn(),
  };
}

function useFrameProcessor(
  frameProcessor: ReturnType<typeof createManualFrameProcessor>,
): VadWorkerClient {
  const worker = createWorkerForFrameProcessor(frameProcessor);
  mocks.createVadWorkerClient.mockReturnValue(worker);
  return worker;
}

async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("streamingVad", () => {
  beforeEach(() => {
    mocks.createVadWorkerClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-chunks 30ms capture frames into fixed 1536-sample model windows", async () => {
    const fp = createManualFrameProcessor();
    useFrameProcessor(fp);

    const session = createStreamingVadSession();
    await flush();

    // 8 frames of 480 samples = 3840 samples -> two full 1536 windows, 768 left over.
    for (let i = 0; i < 8; i++) {
      session.pushFrame(new Int16Array(480));
    }
    await flush();

    expect(fp.process).toHaveBeenCalledTimes(2);
    expect(fp.process.mock.calls[0][0]).toHaveLength(1536);
    expect(fp.process.mock.calls[1][0]).toHaveLength(1536);

    // 4 more frames (1920 samples) -> carried 768 + 1920 = 2688 -> one more
    // window (1536), 1152 left over in the carry buffer.
    for (let i = 0; i < 4; i++) {
      session.pushFrame(new Int16Array(480));
    }
    await flush();

    expect(fp.process).toHaveBeenCalledTimes(3);
    expect(fp.process.mock.calls[2][0]).toHaveLength(1536);
  });

  it("reuses a processed model window buffer for the next window", async () => {
    const fp = createManualFrameProcessor();
    useFrameProcessor(fp);

    const session = createStreamingVadSession();
    await flush();

    session.pushFrame(new Int16Array(1536));
    await flush();
    const firstWindow = fp.process.mock.calls[0][0] as Float32Array;

    session.pushFrame(new Int16Array(1536));
    await flush();
    const secondWindow = fp.process.mock.calls[1][0] as Float32Array;

    expect(secondWindow.buffer).toBe(firstWindow.buffer);
    session.dispose();
  });

  it("keeps one completed window in the recycle slot", async () => {
    const fp = createManualFrameProcessor();
    useFrameProcessor(fp);

    const session = createStreamingVadSession();
    await flush();
    session.pushFrame(new Int16Array(1536));
    session.pushFrame(new Int16Array(1536));
    await flush();

    const internals = session as unknown as {
      recycledWindow: Float32Array | null;
    };
    expect(internals.recycledWindow).toBeInstanceOf(Float32Array);
    session.dispose();
  });

  it("notifies boundary consumers when speech starts and ends", async () => {
    let windowIndex = 0;
    const fp = createManualFrameProcessor((frame, handleEvent) => {
      if (windowIndex === 0) {
        handleEvent({ msg: Message.SpeechStart });
      } else if (windowIndex === 1) {
        handleEvent({ msg: Message.SpeechEnd, audio: frame });
      }
      windowIndex += 1;
    });
    useFrameProcessor(fp);

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    const session = createStreamingVadSession({ onSpeechStart, onSpeechEnd });
    await flush();

    session.pushFrame(new Int16Array(1536));
    session.pushFrame(new Int16Array(1536));
    await flush();

    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("drops a trailing partial window at finish(), matching NonRealTimeVAD.run()", async () => {
    const fp = createManualFrameProcessor();
    const worker = useFrameProcessor(fp);

    const session = createStreamingVadSession();
    await flush();

    session.pushFrame(new Int16Array(1536)); // one full window
    session.pushFrame(new Int16Array(700)); // leftover, never reaches 1536
    await flush();

    expect(fp.process).toHaveBeenCalledTimes(1);

    const audio = createCapturedAudio(new Int16Array(4000));
    await session.finish(audio);

    // The leftover 700 samples were never fed to the model (same as
    // Resampler.stream() dropping a trailing partial frame in the post-hoc
    // path), so no further process() call happens at flush time.
    expect(fp.process).toHaveBeenCalledTimes(1);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it("marks itself unusable when the model fails to load, and finish() returns null", async () => {
    const worker: VadWorkerClient = {
      ready: vi.fn().mockRejectedValue(new Error("model load failed")),
      processFrame: vi.fn(),
      finish: vi.fn(),
      runClip: vi.fn(),
      dispose: vi.fn(),
    };
    mocks.createVadWorkerClient.mockReturnValue(worker);

    const session = createStreamingVadSession();
    await flush();

    expect(session.isUsable()).toBe(false);
    expect(worker.dispose).toHaveBeenCalledTimes(1);

    const result = await session.finish(createCapturedAudio(new Int16Array(1600)));
    expect(result).toBeNull();
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  it("returns an unusable session when the browser cannot create a worker", async () => {
    mocks.createVadWorkerClient.mockImplementationOnce(() => {
      throw new Error("worker construction failed");
    });

    const session = createStreamingVadSession();

    expect(session.isUsable()).toBe(false);
    expect(() => session.pushFrame(new Int16Array(1536))).not.toThrow();
    await expect(session.waitForQuiet(240)).resolves.toBe(0);
    await expect(
      session.finish(createCapturedAudio(new Int16Array(1600))),
    ).resolves.toBeNull();
    expect(() => session.dispose()).not.toThrow();
  });

  it("creates and terminates a new worker for each sequential session", async () => {
    const firstWorker = createWorkerForFrameProcessor(createManualFrameProcessor());
    const secondWorker = createWorkerForFrameProcessor(createManualFrameProcessor());
    mocks.createVadWorkerClient
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const audio = createCapturedAudio(new Int16Array(1600));

    const first = createStreamingVadSession();
    await flush();
    await first.finish(audio);

    expect(firstWorker.dispose).toHaveBeenCalledOnce();

    const second = createStreamingVadSession();
    await flush();

    expect(mocks.createVadWorkerClient).toHaveBeenCalledTimes(2);
    await second.finish(audio);
    expect(secondWorker.dispose).toHaveBeenCalledOnce();
  });

  it("returns null when cancellation races with finish and never reuses the worker", async () => {
    const fp = createManualFrameProcessor();
    const worker = createWorkerForFrameProcessor(fp);
    const replacement = createWorkerForFrameProcessor(createManualFrameProcessor());
    mocks.createVadWorkerClient
      .mockReturnValueOnce(worker)
      .mockReturnValueOnce(replacement);
    let resolveFinish = (_events: VadWorkerEvent[]): void => {};
    worker.finish = vi.fn((_frameIndex: number): Promise<VadWorkerEvent[]> =>
      new Promise((resolve) => {
        resolveFinish = resolve;
      }),
    );
    const audio = createCapturedAudio(new Int16Array(1600));
    const session = createStreamingVadSession();

    await flush();
    const finishing = session.finish(audio);
    await vi.waitFor(() => {
      expect(worker.finish).toHaveBeenCalledTimes(1);
    });

    session.dispose();
    expect(worker.dispose).toHaveBeenCalledTimes(1);

    resolveFinish([]);
    await expect(finishing).resolves.toBeNull();

    const replacementSession = createStreamingVadSession();
    expect(mocks.createVadWorkerClient).toHaveBeenCalledTimes(2);
    expect(mocks.createVadWorkerClient).toHaveBeenNthCalledWith(2);
    replacementSession.dispose();
    expect(replacement.dispose).toHaveBeenCalledOnce();
  });

  it("terminates a cancelled worker exactly once and stops accepting frames", async () => {
    const fp = createManualFrameProcessor();
    const worker = useFrameProcessor(fp);

    const session = createStreamingVadSession();
    await flush();
    session.dispose();
    session.dispose();

    session.pushFrame(new Int16Array(1536));
    await flush();

    expect(fp.process).not.toHaveBeenCalled();
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker when frame processing fails", async () => {
    const worker = createWorkerForFrameProcessor(createManualFrameProcessor());
    worker.processFrame = vi.fn().mockRejectedValue(new Error("process failed"));
    mocks.createVadWorkerClient.mockReturnValue(worker);

    const session = createStreamingVadSession();
    await flush();
    session.pushFrame(new Int16Array(1536));
    await flush();

    expect(worker.dispose).toHaveBeenCalledOnce();
    await expect(session.finish(createCapturedAudio(new Int16Array(1600)))).resolves.toBeNull();
    expect(worker.finish).not.toHaveBeenCalled();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it("falls back when the worker backlog reaches its memory bound", async () => {
    const worker = createWorkerForFrameProcessor(createManualFrameProcessor());
    worker.processFrame = vi.fn().mockReturnValue(
      new Promise<VadWorkerProcessResult>(() => undefined),
    );
    mocks.createVadWorkerClient.mockReturnValue(worker);

    const session = createStreamingVadSession();
    await flush();

    for (let i = 0; i < 65; i++) {
      session.pushFrame(new Int16Array(1536));
    }

    expect(session.isUsable()).toBe(false);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it("terminates the worker when finalization fails", async () => {
    const worker = createWorkerForFrameProcessor(createManualFrameProcessor());
    worker.finish = vi.fn().mockRejectedValue(new Error("finish failed"));
    mocks.createVadWorkerClient.mockReturnValue(worker);

    const session = createStreamingVadSession();
    await flush();

    await expect(session.finish(createCapturedAudio(new Int16Array(1600)))).resolves.toBeNull();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  describe("adaptive post-roll decision (waitForQuiet)", () => {
    it("resolves immediately (0ms) when no speech was ever detected", async () => {
      const fp = createManualFrameProcessor();
      useFrameProcessor(fp);

      const session = createStreamingVadSession();
      await flush();

      session.pushFrame(new Int16Array(1536));
      await flush();

      const waited = await session.waitForQuiet(240);
      expect(waited).toBe(0);
    });

    it("keeps waiting while speech is still active, capped at maxWaitMs", async () => {
      const fp = createManualFrameProcessor(async (frame, handleEvent) => {
        handleEvent({ msg: Message.SpeechStart });
        handleEvent({
          msg: Message.FrameProcessed,
          probs: { isSpeech: 1, notSpeech: 0 },
          frame,
        });
      });
      useFrameProcessor(fp);

      const session = createStreamingVadSession();
      await flush();
      session.pushFrame(new Int16Array(1536));
      await flush();

      const waited = await session.waitForQuiet(60);
      expect(waited).toBe(60);
    });

    it("resolves once enough quiet audio accumulates, before the cap", async () => {
      let windowIndex = 0;
      const fp = createManualFrameProcessor(async (frame, handleEvent) => {
        if (windowIndex === 0) {
          handleEvent({ msg: Message.SpeechStart });
        }
        if (windowIndex === 1) {
          handleEvent({ msg: Message.SpeechEnd, audio: frame });
        }
        handleEvent({
          msg: Message.FrameProcessed,
          probs: { isSpeech: windowIndex < 1 ? 1 : 0, notSpeech: windowIndex < 1 ? 0 : 1 },
          frame,
        });
        windowIndex += 1;
      });
      useFrameProcessor(fp);

      const session = createStreamingVadSession();
      await flush();

      // Two windows: speech starts, then ends (192ms of captured audio,
      // speechEndAtMs = 192ms). VAD_REDEMPTION_MS is 200ms, so we're not
      // quiet yet purely from these two windows.
      session.pushFrame(new Int16Array(1536));
      session.pushFrame(new Int16Array(1536));
      await flush();

      const waitPromise = session.waitForQuiet(500);
      // Simulate real-time capture continuing during the post-roll wait
      // (silence keeps flowing in) until enough time has accumulated past
      // the redemption window.
      const pushSilence = () => session.pushFrame(new Int16Array(1536));
      const timers = [
        setTimeout(pushSilence, 5),
        setTimeout(pushSilence, 15),
        setTimeout(pushSilence, 25),
      ];

      const waited = await waitPromise;
      timers.forEach(clearTimeout);

      expect(waited).toBeGreaterThanOrEqual(0);
      expect(waited).toBeLessThan(500);
    });
  });

  describe("parity with the post-hoc NonRealTimeVAD path", () => {
    it("produces the same segments and trimmed audio as feeding the whole clip through NonRealTimeVAD.run()", async () => {
      const totalWindows = 30;
      const speechWindows = new Set([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
      const isSpeechScript = (windowIndex: number) => speechWindows.has(windowIndex);

      const totalSamples = totalWindows * FAKE_VAD_MODEL_FRAME_SAMPLES;
      const pcm16 = new Int16Array(totalSamples);
      for (let i = 0; i < pcm16.length; i++) {
        // Content is irrelevant to the fake model (it only counts calls),
        // but keep it non-zero so this isn't a degenerate all-silence buffer.
        pcm16[i] = (i % 2000) - 1000;
      }
      const capturedAudio = createCapturedAudio(pcm16, { sampleRateHz: 16000 });

      // --- post-hoc path: the real NonRealTimeVAD.run() over the whole clip ---
      const postHocVad = createScriptedNonRealTimeVad(isSpeechScript);
      const postHocSegments: VadSpeechSegment[] = [];
      for await (const seg of postHocVad.run(pcm16ToFloat32(pcm16), 16000)) {
        postHocSegments.push({ startMs: seg.start, endMs: seg.end });
      }
      const postHocResult = trimCapturedAudioToSpeech(capturedAudio, postHocSegments, {
        preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
        redemptionMs: VAD_REDEMPTION_MS,
      });

      // Sanity: the scripted speech run should actually have produced a segment.
      expect(postHocResult.speechDetected).toBe(true);

      // --- streaming path: the same clip fed as real-time 30ms capture frames ---
      const streamingFrameProcessor = createScriptedFrameProcessor(isSpeechScript);
      useFrameProcessor(streamingFrameProcessor as never);

      const session = createStreamingVadSession();
      await flush();

      const captureFrameSamples = 480; // 30ms @ 16kHz, matches PCM_CAPTURE_FRAME_SAMPLES
      for (let offset = 0; offset < pcm16.length; offset += captureFrameSamples) {
        session.pushFrame(pcm16.subarray(offset, offset + captureFrameSamples));
      }
      const streamingResult = await session.finish(capturedAudio);

      expect(streamingResult).not.toBeNull();
      expect(streamingResult?.segments).toEqual(postHocResult.segments);
      expect(streamingResult?.trimRange).toEqual(postHocResult.trimRange);
      expect(streamingResult?.speechDetected).toBe(postHocResult.speechDetected);
      expect(streamingResult?.leadingTrimmedMs).toBe(postHocResult.leadingTrimmedMs);
      expect(streamingResult?.trailingTrimmedMs).toBe(postHocResult.trailingTrimmedMs);
      expect(Array.from(streamingResult!.audio.pcm16)).toEqual(
        Array.from(postHocResult.audio.pcm16),
      );
    });
  });
});
