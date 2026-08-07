import { beforeEach, describe, expect, it, vi } from "vitest";
import { trimCapturedAudioWithVad } from "./vadTrimmer";
import type { VadWorkerClient } from "./vadWorkerClient";
import { createCapturedAudio } from "../core/transcription/capturedAudio";
import {
  createScriptedNonRealTimeVad,
  FAKE_VAD_MODEL_FRAME_SAMPLES,
} from "../test/fakes/fakeVadModel";

const mocks = vi.hoisted(() => ({
  createVadWorkerClient: vi.fn(),
}));

vi.mock("./vadWorkerClient", () => ({
  createVadWorkerClient: mocks.createVadWorkerClient,
}));

function useVad(vad: ReturnType<typeof createScriptedNonRealTimeVad>) {
  const worker: VadWorkerClient = {
    ready: vi.fn().mockResolvedValue(undefined),
    processFrame: vi.fn(),
    finish: vi.fn(),
    runClip: vi.fn(async (audio: Float32Array, sampleRateHz: number) => {
      const segments = [];
      for await (const segment of vad.run(audio, sampleRateHz)) {
        segments.push({ startMs: segment.start, endMs: segment.end });
      }
      return segments;
    }),
    dispose: vi.fn(),
  };
  mocks.createVadWorkerClient.mockReturnValue(worker);
  return worker;
}

describe("trimCapturedAudioWithVad (post-hoc fallback path)", () => {
  beforeEach(() => {
    mocks.createVadWorkerClient.mockReset();
  });

  it("runs the real NonRealTimeVAD state machine over the whole clip and trims to detected speech", async () => {
    const totalWindows = 20;
    const speechWindows = new Set([5, 6, 7, 8, 9, 10]);
    const vad = createScriptedNonRealTimeVad((windowIndex) =>
      speechWindows.has(windowIndex),
    );
    const worker = useVad(vad);

    const totalSamples = totalWindows * FAKE_VAD_MODEL_FRAME_SAMPLES;
    const pcm16 = new Int16Array(totalSamples);
    const audio = createCapturedAudio(pcm16, { sampleRateHz: 16000 });

    const result = await trimCapturedAudioWithVad(audio);

    expect(result.speechDetected).toBe(true);
    expect(result.segments.length).toBe(1);
    expect(result.audio.pcm16.length).toBeLessThan(pcm16.length);
    expect(result.audio.pcm16.length).toBeGreaterThan(0);
    expect(result.vadMs).toBeGreaterThanOrEqual(0);
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports no speech detected and leaves audio untouched when nothing crosses the threshold", async () => {
    const vad = createScriptedNonRealTimeVad(() => false);
    const worker = useVad(vad);

    const totalSamples = 10 * FAKE_VAD_MODEL_FRAME_SAMPLES;
    const pcm16 = new Int16Array(totalSamples);
    const audio = createCapturedAudio(pcm16, { sampleRateHz: 16000 });

    const result = await trimCapturedAudioWithVad(audio);

    expect(result.speechDetected).toBe(false);
    expect(result.audio.pcm16.length).toBe(pcm16.length);
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects audio captured at the wrong sample rate", async () => {
    const audio = createCapturedAudio(new Int16Array(1600), {
      sampleRateHz: 48_000,
    });

    await expect(trimCapturedAudioWithVad(audio)).rejects.toThrow(/16000 Hz/);
    expect(mocks.createVadWorkerClient).not.toHaveBeenCalled();
  });

  it("propagates model resolution failures to the caller", async () => {
    const worker: VadWorkerClient = {
      ready: vi.fn().mockRejectedValue(new Error("model unavailable")),
      processFrame: vi.fn(),
      finish: vi.fn(),
      runClip: vi.fn(),
      dispose: vi.fn(),
    };
    mocks.createVadWorkerClient.mockReturnValue(worker);

    const audio = createCapturedAudio(new Int16Array(1600), {
      sampleRateHz: 16000,
    });

    await expect(trimCapturedAudioWithVad(audio)).rejects.toThrow(
      "model unavailable",
    );
    expect(worker.dispose).toHaveBeenCalledTimes(1);
  });
});
