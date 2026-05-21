export const CAPTURED_AUDIO_FORMAT = "pcm16" as const;
export const CAPTURED_AUDIO_SAMPLE_RATE_HZ = 16_000;
export const CAPTURED_AUDIO_CHANNEL_COUNT = 1;
export const PCM16_BYTES_PER_SAMPLE = 2;
export const PCM16_BITS_PER_SAMPLE = 16;

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

export interface Pcm16WavOptions {
  sampleRateHz?: number;
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

export function concatPcm16(chunks: readonly Int16Array[]): Int16Array {
  let totalSamples = 0;
  for (const chunk of chunks) {
    assertPcm16(chunk);
    totalSamples += chunk.length;
  }

  const out = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
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

export function encodeCapturedAudioAsWav(audio: CapturedAudio): ArrayBuffer {
  return encodePcm16Wav(audio.pcm16, {
    sampleRateHz: audio.sampleRateHz,
  });
}

export function encodePcm16Wav(
  pcm16: Int16Array,
  options: Pcm16WavOptions = {},
): ArrayBuffer {
  assertPcm16(pcm16);
  const sampleRateHz = normalizeSampleRateHz(options.sampleRateHz);
  const dataByteLength = pcm16.length * PCM16_BYTES_PER_SAMPLE;
  const fileByteLength = 44 + dataByteLength;

  if (fileByteLength > 0xffffffff) {
    throw new Error("PCM16 buffer is too large to encode as a WAV file.");
  }

  const buffer = new ArrayBuffer(fileByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CAPTURED_AUDIO_CHANNEL_COUNT, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(
    28,
    sampleRateHz * CAPTURED_AUDIO_CHANNEL_COUNT * PCM16_BYTES_PER_SAMPLE,
    true,
  );
  view.setUint16(
    32,
    CAPTURED_AUDIO_CHANNEL_COUNT * PCM16_BYTES_PER_SAMPLE,
    true,
  );
  view.setUint16(34, PCM16_BITS_PER_SAMPLE, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  let byteOffset = 44;
  for (let i = 0; i < pcm16.length; i++) {
    view.setInt16(byteOffset, pcm16[i], true);
    byteOffset += PCM16_BYTES_PER_SAMPLE;
  }

  return buffer;
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

function writeAscii(view: DataView, byteOffset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(byteOffset + i, value.charCodeAt(i));
  }
}
