import { pcm16ToFloat32 } from "../core/transcription/capturedAudio";
import {
  CAPTURED_AUDIO_SAMPLE_RATE_HZ,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  trimCapturedAudioToSpeech,
  type VadAudioResult,
  type VadSpeechSegment,
} from "../core/transcription/vadTrim";
import {
  VAD_INIT_TIMEOUT_MS,
  VAD_MAX_TIMEOUT_MS,
  VAD_MIN_TIMEOUT_MS,
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
  VAD_SAMPLE_RATE_HZ,
  VAD_TIMEOUT_AUDIO_MULTIPLIER,
} from "../config/vad";
import {
  createVadTimeoutError,
  invalidateVadModel,
  prewarmVadModel,
  resolveVadModel,
  withVadTimeout,
  type NonRealTimeVadInstance,
} from "./vadModel";

export type { VadAudioResult } from "../core/transcription/vadTrim";

export async function prewarmVad(): Promise<void> {
  await prewarmVadModel();
}

/**
 * Post-hoc VAD: runs the Silero model over the entire captured clip after
 * recording has stopped. This is the fallback path used when the streaming
 * VAD processor (src/utils/streamingVad.ts) failed to initialize during
 * capture.
 */
export async function trimCapturedAudioWithVad(
  audio: CapturedAudio,
): Promise<VadAudioResult> {
  if (audio.sampleRateHz !== VAD_SAMPLE_RATE_HZ) {
    throw new Error(
      `VAD requires ${VAD_SAMPLE_RATE_HZ} Hz PCM, received ${audio.sampleRateHz} Hz.`,
    );
  }

  const vad = await resolveVadModel(VAD_INIT_TIMEOUT_MS, audio.durationMs);
  const startedAt = performance.now();
  const timeoutMs = getVadTimeoutMs(audio.durationMs);
  const segments: VadSpeechSegment[] = [];
  const floatAudio = pcm16ToFloat32(audio.pcm16);
  const segmentStream = vad.run(floatAudio, CAPTURED_AUDIO_SAMPLE_RATE_HZ);
  const iterator = segmentStream[Symbol.asyncIterator]();

  try {
    let done = false;
    while (!done) {
      const remainingMs = timeoutMs - (performance.now() - startedAt);
      if (remainingMs <= 0) {
        throw createVadTimeoutError(timeoutMs, audio.durationMs);
      }

      const next = await nextVadSegmentWithTimeout(
        iterator,
        remainingMs,
        timeoutMs,
        audio.durationMs,
      );
      done = Boolean(next.done);
      if (done) break;

      segments.push({
        startMs: next.value.start,
        endMs: next.value.end,
      });
    }
  } catch (error) {
    invalidateVadModel();
    try {
      void iterator.return?.(undefined as never);
    } catch {
      // Ignore cleanup failures after a timed-out VAD pass.
    }
    throw error;
  }

  const result = trimCapturedAudioToSpeech(audio, segments, {
    preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
    redemptionMs: VAD_REDEMPTION_MS,
  });

  return {
    ...result,
    vadMs: Math.round(performance.now() - startedAt),
  };
}

function getVadTimeoutMs(audioDurationMs: number): number {
  const scaled = audioDurationMs * VAD_TIMEOUT_AUDIO_MULTIPLIER;
  return Math.round(
    Math.min(VAD_MAX_TIMEOUT_MS, Math.max(VAD_MIN_TIMEOUT_MS, scaled)),
  );
}

function nextVadSegmentWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  totalTimeoutMs: number,
  audioDurationMs: number,
): Promise<IteratorResult<T>> {
  return withVadTimeout(
    iterator.next(),
    timeoutMs,
    totalTimeoutMs,
    audioDurationMs,
    "processing",
  );
}

// Re-exported so downstream modules that only care about "is there a VAD
// instance available" don't need to import vadModel.ts directly.
export type { NonRealTimeVadInstance };
