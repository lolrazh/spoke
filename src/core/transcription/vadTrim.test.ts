import { describe, expect, it } from "vitest";
import { createCapturedAudio } from "./capturedAudio";
import { normalizeVadSegments, trimCapturedAudioToSpeech } from "./vadTrim";

describe("vadTrim", () => {
  it("normalizes VAD segments to valid sorted ranges", () => {
    expect(
      normalizeVadSegments(
        [
          { startMs: 900, endMs: 1100 },
          { startMs: -20, endMs: 100 },
          { startMs: 500, endMs: 400 },
        ],
        1000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 900, endMs: 1000 },
    ]);
  });

  it("reports no speech without changing audio when no segments exist", () => {
    const audio = createCapturedAudio(new Int16Array(16_000));

    const result = trimCapturedAudioToSpeech(audio, [], {
      preSpeechPadMs: 300,
      redemptionMs: 200,
    });

    expect(result.speechDetected).toBe(false);
    expect(result.audio).toBe(audio);
    expect(result.trimRange).toEqual({
      startSample: 0,
      endSample: 16_000,
    });
  });

  it("trims leading and trailing silence around detected speech", () => {
    const audio = createCapturedAudio(new Int16Array(32_000));

    const result = trimCapturedAudioToSpeech(
      audio,
      [{ startMs: 700, endMs: 1300 }],
      {
        preSpeechPadMs: 300,
        redemptionMs: 200,
      },
    );

    expect(result.speechDetected).toBe(true);
    expect(result.trimRange).toEqual({
      startSample: 6_400,
      endSample: 24_000,
    });
    expect(result.audio.pcm16.length).toBe(17_600);
    expect(result.audio.durationMs).toBe(1100);
    expect(result.leadingTrimmedMs).toBe(400);
    expect(result.trailingTrimmedMs).toBe(500);
  });

  it("reuses audio when the speech range already covers the clip", () => {
    const audio = createCapturedAudio(new Int16Array(16_000));

    const result = trimCapturedAudioToSpeech(
      audio,
      [{ startMs: 0, endMs: 1_000 }],
      {
        preSpeechPadMs: 300,
        redemptionMs: 200,
      },
    );

    expect(result.audio).toBe(audio);
    expect(result.trimRange).toEqual({
      startSample: 0,
      endSample: 16_000,
    });
  });

  it("uses the first and last speech segment for a single final trim", () => {
    const audio = createCapturedAudio(new Int16Array(48_000));

    const result = trimCapturedAudioToSpeech(
      audio,
      [
        { startMs: 800, endMs: 1100 },
        { startMs: 2200, endMs: 2600 },
      ],
      {
        preSpeechPadMs: 100,
        redemptionMs: 100,
      },
    );

    expect(result.trimRange).toEqual({
      startSample: 11_200,
      endSample: 43_200,
    });
    expect(result.audio.durationMs).toBe(2000);
  });
});
