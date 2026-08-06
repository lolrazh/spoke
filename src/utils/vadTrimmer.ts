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
  VAD_MAX_TIMEOUT_MS,
  VAD_MIN_TIMEOUT_MS,
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
  VAD_SAMPLE_RATE_HZ,
  VAD_TIMEOUT_AUDIO_MULTIPLIER,
} from "../config/vad";
import { createVadWorkerClient } from "./vadWorkerClient";

export type { VadAudioResult } from "../core/transcription/vadTrim";

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

  const worker = createVadWorkerClient();

  try {
    await worker.ready();
    const startedAt = performance.now();
    const segments: VadSpeechSegment[] = await worker.runClip(
      pcm16ToFloat32(audio.pcm16),
      CAPTURED_AUDIO_SAMPLE_RATE_HZ,
      getVadTimeoutMs(audio.durationMs),
    );
    const result = trimCapturedAudioToSpeech(audio, segments, {
      preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
      redemptionMs: VAD_REDEMPTION_MS,
    });

    return {
      ...result,
      vadMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    worker.dispose();
  }
}

function getVadTimeoutMs(audioDurationMs: number): number {
  const scaled = audioDurationMs * VAD_TIMEOUT_AUDIO_MULTIPLIER;
  return Math.round(
    Math.min(VAD_MAX_TIMEOUT_MS, Math.max(VAD_MIN_TIMEOUT_MS, scaled)),
  );
}
