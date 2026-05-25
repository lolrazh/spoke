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
  VAD_MIN_SPEECH_MS,
  VAD_NEGATIVE_SPEECH_THRESHOLD,
  VAD_POSITIVE_SPEECH_THRESHOLD,
  VAD_PRE_SPEECH_PAD_MS,
  VAD_REDEMPTION_MS,
  VAD_SAMPLE_RATE_HZ,
} from "../config/vad";

type NonRealTimeVadInstance = Awaited<
  ReturnType<typeof import("@ricky0123/vad-web").NonRealTimeVAD.new>
>;

export interface VadAudioResult extends VadTrimResult {
  vadMs: number;
}

let vadPromise: Promise<NonRealTimeVadInstance> | null = null;

export async function trimCapturedAudioWithVad(
  audio: CapturedAudio,
): Promise<VadAudioResult> {
  const startedAt = performance.now();

  if (audio.sampleRateHz !== VAD_SAMPLE_RATE_HZ) {
    throw new Error(
      `VAD requires ${VAD_SAMPLE_RATE_HZ} Hz PCM, received ${audio.sampleRateHz} Hz.`,
    );
  }

  const vad = await getVad();
  const segments: VadSpeechSegment[] = [];
  const floatAudio = pcm16ToFloat32(audio.pcm16);

  for await (const segment of vad.run(
    floatAudio,
    CAPTURED_AUDIO_SAMPLE_RATE_HZ,
  )) {
    segments.push({
      startMs: segment.start,
      endMs: segment.end,
    });
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
    vadPromise = createVad().catch((error) => {
      vadPromise = null;
      throw error;
    });
  }
  return vadPromise;
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
