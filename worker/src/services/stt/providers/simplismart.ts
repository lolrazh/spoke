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

  // Convert WAV audio to base64 (process in chunks to avoid stack overflow)
  const chunkSize = 8192;
  let binaryString = '';
  for (let i = 0; i < wav.length; i += chunkSize) {
    const chunk = wav.subarray(i, Math.min(i + chunkSize, wav.length));
    binaryString += String.fromCharCode(...chunk);
  }
  const base64Audio = btoa(binaryString);

  // Build request body following Simplismart API format
  const requestBody = {
    audio_data: base64Audio,
    language: language,
    task: 'transcribe' as const,
    word_timestamps: false,
    diarization: false,
    vad_filter: false,
    batch_size: 24,
    length_penalty: 1,
    vad_onset: 0.5,
    vad_offset: 0.363,
    beam_size: 5,
    initial_prompt: prompt || undefined,
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
