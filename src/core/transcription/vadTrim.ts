import {
  trimCapturedAudio,
  type CapturedAudio,
  type Pcm16TrimRange,
} from "./capturedAudio";

export interface VadSpeechSegment {
  startMs: number;
  endMs: number;
}

export interface VadTrimOptions {
  preSpeechPadMs: number;
  redemptionMs: number;
}

export interface VadTrimResult {
  audio: CapturedAudio;
  speechDetected: boolean;
  segments: VadSpeechSegment[];
  trimRange: Pcm16TrimRange;
  leadingTrimmedMs: number;
  trailingTrimmedMs: number;
}

/**
 * A `VadTrimResult` plus the wall-clock cost of producing it. Shared by both
 * the post-hoc (whole-clip) and streaming VAD paths so callers can log
 * latency uniformly regardless of which path produced the result.
 */
export interface VadAudioResult extends VadTrimResult {
  vadMs: number;
}

export function trimCapturedAudioToSpeech(
  audio: CapturedAudio,
  segments: readonly VadSpeechSegment[],
  options: VadTrimOptions,
): VadTrimResult {
  const normalizedSegments = normalizeVadSegments(segments, audio.durationMs);

  if (normalizedSegments.length === 0) {
    return {
      audio,
      speechDetected: false,
      segments: [],
      trimRange: {
        startSample: 0,
        endSample: audio.pcm16.length,
      },
      leadingTrimmedMs: 0,
      trailingTrimmedMs: 0,
    };
  }

  const first = normalizedSegments[0];
  const last = normalizedSegments[normalizedSegments.length - 1];
  const startMs = Math.max(0, first.startMs - options.preSpeechPadMs);
  const endMs = Math.min(audio.durationMs, last.endMs + options.redemptionMs);

  const trimRange = {
    startSample: msToSample(startMs, audio.sampleRateHz, "floor"),
    endSample: msToSample(endMs, audio.sampleRateHz, "ceil"),
  };
  const trimmedAudio = trimCapturedAudio(audio, trimRange);

  return {
    audio: trimmedAudio,
    speechDetected: true,
    segments: normalizedSegments,
    trimRange,
    leadingTrimmedMs: startMs,
    trailingTrimmedMs: Math.max(0, audio.durationMs - endMs),
  };
}

export function normalizeVadSegments(
  segments: readonly VadSpeechSegment[],
  durationMs: number,
): VadSpeechSegment[] {
  return segments
    .map((segment) => ({
      startMs: clampMs(segment.startMs, durationMs),
      endMs: clampMs(segment.endMs, durationMs),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

function msToSample(
  valueMs: number,
  sampleRateHz: number,
  rounding: "floor" | "ceil",
): number {
  const sample = (valueMs / 1000) * sampleRateHz;
  return rounding === "floor" ? Math.floor(sample) : Math.ceil(sample);
}

function clampMs(value: number, maxMs: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(maxMs, value));
}
