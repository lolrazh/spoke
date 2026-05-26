import {
  CAPTURED_AUDIO_SAMPLE_RATE_HZ,
  type CapturedAudio,
} from "../core/transcription/capturedAudio";
import {
  trimCapturedAudioToSpeech,
  type VadSpeechSegment,
  type VadTrimResult,
} from "../core/transcription/vadTrim";
import {
  getVadModelUrl,
  getVadOrtWasmBaseUrl,
  VAD_INIT_TIMEOUT_MS,
  VAD_MAX_TIMEOUT_MS,
  VAD_MIN_SPEECH_MS,
  VAD_MIN_TIMEOUT_MS,
  VAD_NEGATIVE_SPEECH_THRESHOLD,
  VAD_POSITIVE_SPEECH_THRESHOLD,
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
  VAD_SAMPLE_RATE_HZ,
  VAD_TIMEOUT_AUDIO_MULTIPLIER,
} from "../config/vad";

type NonRealTimeVadInstance = Awaited<
  ReturnType<typeof import("@ricky0123/vad-web").NonRealTimeVAD.new>
>;

export interface VadAudioResult extends VadTrimResult {
  vadMs: number;
}

let vadPromise: Promise<NonRealTimeVadInstance> | null = null;

export async function prewarmVad(): Promise<void> {
  await resolveVad(VAD_INIT_TIMEOUT_MS, 0);
}

export async function trimCapturedAudioWithVad(
  audio: CapturedAudio,
): Promise<VadAudioResult> {
  if (audio.sampleRateHz !== VAD_SAMPLE_RATE_HZ) {
    throw new Error(
      `VAD requires ${VAD_SAMPLE_RATE_HZ} Hz PCM, received ${audio.sampleRateHz} Hz.`,
    );
  }

  const vad = await resolveVad(VAD_INIT_TIMEOUT_MS, audio.durationMs);
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
    vadPromise = null;
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

function getVad(): Promise<NonRealTimeVadInstance> {
  if (!vadPromise) {
    const pending = createVad()
      .then((vad) => {
        if (vadPromise === pending || vadPromise === null) {
          vadPromise = Promise.resolve(vad);
        }
        return vad;
      })
      .catch((error) => {
        if (vadPromise === pending) {
          vadPromise = null;
        }
        throw error;
      });
    vadPromise = pending;
  }
  return vadPromise;
}

async function resolveVad(
  timeoutMs: number,
  audioDurationMs: number,
): Promise<NonRealTimeVadInstance> {
  const pending = getVad();
  try {
    return await withVadTimeout(
      pending,
      timeoutMs,
      timeoutMs,
      audioDurationMs,
      "initialization",
    );
  } catch (error) {
    if (vadPromise === pending) {
      vadPromise = null;
    }
    throw error;
  }
}

async function createVad(): Promise<NonRealTimeVadInstance> {
  const vadWeb = await import("@ricky0123/vad-web");

  return vadWeb.NonRealTimeVAD.new({
    modelURL: getVadModelUrl(),
    modelFetcher: fetchArrayBuffer,
    positiveSpeechThreshold: VAD_POSITIVE_SPEECH_THRESHOLD,
    negativeSpeechThreshold: VAD_NEGATIVE_SPEECH_THRESHOLD,
    minSpeechMs: VAD_MIN_SPEECH_MS,
    preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
    redemptionMs: VAD_REDEMPTION_MS,
    submitUserSpeechOnPause: false,
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
      ort.env.wasm.initTimeout = VAD_INIT_TIMEOUT_MS;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = getVadOrtWasmBaseUrl();
    },
  });
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load VAD asset ${url}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
  const out = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    out[i] = pcm16[i] / 32768;
  }
  return out;
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

function withVadTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  totalTimeoutMs: number,
  audioDurationMs: number,
  stage: "initialization" | "processing",
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(createVadTimeoutError(totalTimeoutMs, audioDurationMs, stage));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function createVadTimeoutError(
  timeoutMs: number,
  audioDurationMs: number,
  stage: "initialization" | "processing" = "processing",
): Error {
  const audioContext =
    audioDurationMs > 0
      ? ` while processing ${Math.round(audioDurationMs)}ms of audio`
      : "";

  return new Error(
    `VAD ${stage} timed out after ${Math.round(timeoutMs)}ms${audioContext}.`,
  );
}
