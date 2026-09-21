import { describe, expect, it } from "vitest";
import {
  CAPTURED_AUDIO_CHANNEL_COUNT,
  CAPTURED_AUDIO_SAMPLE_RATE_HZ,
  createCapturedAudio,
  getPcm16DurationMs,
  normalizePcm16TrimRange,
  pcm16ToFloat32,
  trimCapturedAudio,
  trimPcm16,
} from "./capturedAudio";

describe("capturedAudio", () => {
  it("creates canonical PCM16 captured audio", () => {
    const pcm16 = new Int16Array(8_000);

    const audio = createCapturedAudio(pcm16);

    expect(audio).toEqual({
      format: "pcm16",
      sampleRateHz: CAPTURED_AUDIO_SAMPLE_RATE_HZ,
      channelCount: CAPTURED_AUDIO_CHANNEL_COUNT,
      pcm16,
      durationMs: 500,
    });
  });

  it("computes PCM16 duration from sample count and sample rate", () => {
    expect(getPcm16DurationMs(16_000)).toBe(1000);
    expect(getPcm16DurationMs(24_000, 48_000)).toBe(500);
  });

  it("normalizes trim ranges by clamping to available samples", () => {
    expect(
      normalizePcm16TrimRange(10, {
        startSample: -4,
        endSample: 99,
      }),
    ).toEqual({
      startSample: 0,
      endSample: 10,
    });
  });

  it("turns reversed trim ranges into an empty range at the requested end", () => {
    expect(
      normalizePcm16TrimRange(10, {
        startSample: 8,
        endSample: 3,
      }),
    ).toEqual({
      startSample: 3,
      endSample: 3,
    });
  });

  it("trims PCM16 using inclusive start and exclusive end samples", () => {
    const result = trimPcm16(new Int16Array([10, 20, 30, 40, 50]), {
      startSample: 1,
      endSample: 4,
    });

    expect(Array.from(result)).toEqual([20, 30, 40]);
  });

  it("trims captured audio and refreshes duration", () => {
    const audio = createCapturedAudio(new Int16Array(16_000));

    const trimmed = trimCapturedAudio(audio, {
      startSample: 4_000,
      endSample: 12_000,
    });

    expect(trimmed.sampleRateHz).toBe(16_000);
    expect(trimmed.durationMs).toBe(500);
    expect(trimmed.pcm16.length).toBe(8_000);
  });

  it("converts PCM16 samples to normalized Float32 in [-1, 1)", () => {
    const float32 = pcm16ToFloat32(new Int16Array([0, 32_767, -32_768]));

    expect(float32.length).toBe(3);
    expect(float32[0]).toBeCloseTo(0);
    expect(float32[1]).toBeCloseTo(0.99997, 4);
    expect(float32[2]).toBeCloseTo(-1);
  });

  it("rejects invalid sample rates", () => {
    expect(() =>
      createCapturedAudio(new Int16Array(), {
        sampleRateHz: 0,
      }),
    ).toThrow("PCM sample rate must be a positive integer.");
  });
});
