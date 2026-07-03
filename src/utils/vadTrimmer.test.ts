import { beforeEach, describe, expect, it, vi } from "vitest";
import { trimCapturedAudioWithVad } from "./vadTrimmer";
import { resolveVadModel } from "./vadModel";
import { createCapturedAudio } from "../core/transcription/capturedAudio";
import {
  createScriptedNonRealTimeVad,
  FAKE_VAD_MODEL_FRAME_SAMPLES,
} from "../test/fakes/fakeVadModel";

// vadTrimmer.trimCapturedAudioWithVad is the fallback path used when the
// streaming VAD processor (streamingVad.ts) never became usable. It must
// keep working exactly as it did before streaming VAD existed: resolve the
// shared model, run it over the whole clip via NonRealTimeVAD.run(), and
// trim to the detected speech.
vi.mock("./vadModel", async () => {
  const actual = await vi.importActual<typeof import("./vadModel")>("./vadModel");
  return {
    ...actual,
    resolveVadModel: vi.fn(),
  };
});

describe("trimCapturedAudioWithVad (post-hoc fallback path)", () => {
  beforeEach(() => {
    vi.mocked(resolveVadModel).mockReset();
  });

  it("runs the real NonRealTimeVAD state machine over the whole clip and trims to detected speech", async () => {
    const totalWindows = 20;
    const speechWindows = new Set([5, 6, 7, 8, 9, 10]);
    const vad = createScriptedNonRealTimeVad((windowIndex) =>
      speechWindows.has(windowIndex),
    );
    vi.mocked(resolveVadModel).mockResolvedValue(vad as never);

    const totalSamples = totalWindows * FAKE_VAD_MODEL_FRAME_SAMPLES;
    const pcm16 = new Int16Array(totalSamples);
    const audio = createCapturedAudio(pcm16, { sampleRateHz: 16000 });

    const result = await trimCapturedAudioWithVad(audio);

    expect(result.speechDetected).toBe(true);
    expect(result.segments.length).toBe(1);
    expect(result.audio.pcm16.length).toBeLessThan(pcm16.length);
    expect(result.audio.pcm16.length).toBeGreaterThan(0);
    expect(result.vadMs).toBeGreaterThanOrEqual(0);
  });

  it("reports no speech detected and leaves audio untouched when nothing crosses the threshold", async () => {
    const vad = createScriptedNonRealTimeVad(() => false);
    vi.mocked(resolveVadModel).mockResolvedValue(vad as never);

    const totalSamples = 10 * FAKE_VAD_MODEL_FRAME_SAMPLES;
    const pcm16 = new Int16Array(totalSamples);
    const audio = createCapturedAudio(pcm16, { sampleRateHz: 16000 });

    const result = await trimCapturedAudioWithVad(audio);

    expect(result.speechDetected).toBe(false);
    expect(result.audio.pcm16.length).toBe(pcm16.length);
  });

  it("rejects audio captured at the wrong sample rate", async () => {
    const audio = createCapturedAudio(new Int16Array(1600), {
      sampleRateHz: 48_000,
    });

    await expect(trimCapturedAudioWithVad(audio)).rejects.toThrow(/16000 Hz/);
    expect(resolveVadModel).not.toHaveBeenCalled();
  });

  it("propagates model resolution failures to the caller", async () => {
    vi.mocked(resolveVadModel).mockRejectedValue(new Error("model unavailable"));

    const audio = createCapturedAudio(new Int16Array(1600), {
      sampleRateHz: 16000,
    });

    await expect(trimCapturedAudioWithVad(audio)).rejects.toThrow(
      "model unavailable",
    );
  });
});
