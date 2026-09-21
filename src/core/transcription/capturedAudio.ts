const CAPTURED_AUDIO_FORMAT = "pcm16" as const;
export const CAPTURED_AUDIO_SAMPLE_RATE_HZ = 16_000;
export const CAPTURED_AUDIO_CHANNEL_COUNT = 1;
const PCM16_TO_FLOAT_GAIN = 1 / 32768;

export type CapturedAudioFormat = typeof CAPTURED_AUDIO_FORMAT;

export interface CapturedAudio {
  format: CapturedAudioFormat;
  sampleRateHz: number;
  channelCount: typeof CAPTURED_AUDIO_CHANNEL_COUNT;
  pcm16: Int16Array;
  durationMs: number;
}

export interface CreateCapturedAudioOptions {
  sampleRateHz?: number;
}

export interface Pcm16TrimRange {
  /**
   * Inclusive PCM sample index. Values outside the buffer are clamped.
   */
  startSample?: number;
  /**
   * Exclusive PCM sample index. Values outside the buffer are clamped.
   */
  endSample?: number;
}

export interface NormalizedPcm16TrimRange {
  startSample: number;
  endSample: number;
}

export function createCapturedAudio(
  pcm16: Int16Array,
  options: CreateCapturedAudioOptions = {},
): CapturedAudio {
  assertPcm16(pcm16);
  const sampleRateHz = normalizeSampleRateHz(options.sampleRateHz);

  return {
    format: CAPTURED_AUDIO_FORMAT,
    sampleRateHz,
    channelCount: CAPTURED_AUDIO_CHANNEL_COUNT,
    pcm16,
    durationMs: getPcm16DurationMs(pcm16.length, sampleRateHz),
  };
}

export function getPcm16DurationMs(
  sampleCount: number,
  sampleRateHz = CAPTURED_AUDIO_SAMPLE_RATE_HZ,
): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new Error("PCM16 sample count must be a non-negative integer.");
  }

  return (sampleCount / normalizeSampleRateHz(sampleRateHz)) * 1000;
}

export function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
  const out = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    out[i] = pcm16[i] * PCM16_TO_FLOAT_GAIN;
  }
  return out;
}

export function normalizePcm16TrimRange(
  sampleCount: number,
  range: Pcm16TrimRange,
): NormalizedPcm16TrimRange {
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new Error("PCM16 sample count must be a non-negative integer.");
  }

  const startSample = clampSampleIndex(range.startSample ?? 0, sampleCount);
  const endSample = clampSampleIndex(
    range.endSample ?? sampleCount,
    sampleCount,
  );

  return {
    startSample: Math.min(startSample, endSample),
    endSample,
  };
}

export function trimPcm16(
  pcm16: Int16Array,
  range: Pcm16TrimRange,
): Int16Array {
  assertPcm16(pcm16);
  const normalized = normalizePcm16TrimRange(pcm16.length, range);
  return pcm16.slice(normalized.startSample, normalized.endSample);
}

export function trimCapturedAudio(
  audio: CapturedAudio,
  range: Pcm16TrimRange,
): CapturedAudio {
  return createCapturedAudio(trimPcm16(audio.pcm16, range), {
    sampleRateHz: audio.sampleRateHz,
  });
}

function normalizeSampleRateHz(sampleRateHz?: number): number {
  const rate = sampleRateHz ?? CAPTURED_AUDIO_SAMPLE_RATE_HZ;
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new Error("PCM sample rate must be a positive integer.");
  }
  return rate;
}

function clampSampleIndex(value: number, sampleCount: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("PCM trim sample index must be finite.");
  }
  return Math.max(0, Math.min(sampleCount, Math.floor(value)));
}

function assertPcm16(value: Int16Array): void {
  if (!(value instanceof Int16Array)) {
    throw new Error("Expected PCM16 audio as an Int16Array.");
  }
}
