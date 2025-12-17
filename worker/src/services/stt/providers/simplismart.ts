export type SimplismartTranscriptionTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type SimplismartTranscriptionResult = {
  text: string;
  timings: SimplismartTranscriptionTimings;
};

import {
  SIMPLISMART_STT_ENDPOINT,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_TIMEOUT_MS,
} from '../../../config';
import { DEFAULT_STT_PROMPT } from '../prompt';

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal; language?: string; prompt?: string; model?: string },
): Promise<SimplismartTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;
  const prompt = opts?.prompt ?? DEFAULT_STT_PROMPT;

  // Convert WAV audio to base64
  const base64Audio = btoa(String.fromCharCode(...wav));

  // Build request body following Simplismart API format
  const requestBody = {
    audio_file: base64Audio,
    language: language,
    task: 'transcribe',
    without_timestamps: true,
    vad_model: 'frame',
    vad_filter: true,
    word_timestamps: false,
    vad_onset: 0.5,
    vad_offset: null,
    min_speech_duration_ms: 0,
    max_speech_duration_s: 30,
    min_silence_duration_ms: 2000,
    speech_pad_ms: 400,
    diarization: false,
    initial_prompt: prompt || null,
    hotwords: null,
    num_speakers: 0,
    compression_ratio_threshold: 2.4,
    beam_size: 4,
    temperature: 0.0,
    multilingual: false,
    max_tokens: 400,
    log_prob_threshold: -1.0,
    length_penalty: 1,
    repetition_penalty: 1.01,
    strict_hallucination_reduction: false,
  };

  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const res = await fetch(SIMPLISMART_STT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const headersAt = Date.now();

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Simplismart STT error: ${res.status} ${body}`);
    }

    const json = (await res.json()) as {
      transcription?: string[];
      request_time?: number;
      language?: string;
      segments?: any[];
    };
    const bodyDoneAt = Date.now();

    // Join transcription array into single text
    const transcriptionText = Array.isArray(json?.transcription)
      ? json.transcription.join(' ')
      : '';

    return {
      text: transcriptionText,
      timings: { startAt, headersAt, bodyDoneAt },
    };
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}
