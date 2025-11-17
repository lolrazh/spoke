export type GroqTranscriptionTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type GroqTranscriptionResult = {
  text: string;
  timings: GroqTranscriptionTimings;
};

import * as Sentry from '@sentry/cloudflare';
import {
  GROQ_STT_ENDPOINT,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_TIMEOUT_MS,
} from '../../../config';
import { DEFAULT_STT_PROMPT } from '../prompt';
import { stripHallucinations } from '../postprocess';

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal; language?: string; prompt?: string; model?: string },
): Promise<GroqTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const model = opts?.model ?? STT_DEFAULT_MODEL;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;
  const prompt = opts?.prompt ?? DEFAULT_STT_PROMPT;

  const form = new FormData();
  const file = new File([wav], 'audio.wav', { type: 'audio/wav' });
  form.append('file', file);
  form.append('model', model);
  form.append('language', language);
  form.append('prompt', prompt);
  form.append('temperature', '0');

  const controller = new AbortController();
  let timeoutTriggered = false;
  const onExternalAbort = () => {
    try {
      console.log(JSON.stringify({
        event: 'stt.abort',
        provider: 'groq',
        reason: 'external_signal',
        elapsedMs: Date.now() - startAt,
      }));
    } catch {}
    controller.abort();
  };
  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    try {
      console.log(JSON.stringify({
        event: 'stt.abort',
        provider: 'groq',
        reason: 'timeout',
        timeoutMs,
        elapsedMs: Date.now() - startAt,
      }));
    } catch {}
    controller.abort();
  }, timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    return await Sentry.startSpan({
      op: 'http.client',
      name: `POST ${GROQ_STT_ENDPOINT}`,
      attributes: {
        'http.request.method': 'POST',
        'server.address': 'api.groq.com',
        'server.port': 443,
        'stt.provider': 'groq',
        'groq.model': model,
        'groq.language': language,
        'audio.size_bytes': wav.length,
        'groq.timeout_ms': timeoutMs,
      },
    }, async (span) => {
      const res = await fetch(GROQ_STT_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
      const headersAt = Date.now();
      
      // Set HTTP response attributes
      span.setAttribute('http.response.status_code', res.status);
      span.setAttribute('http.response_content_length', 
        Number(res.headers.get('content-length')) || 0);
      span.setAttribute('groq.ttfb_ms', headersAt - startAt);
      
      if (!res.ok) {
        const body = await res.text();
        span.setAttribute('groq.error_body', body);
        throw new Error(`GROQ STT error: ${res.status} ${body}`);
      }
      
      const json = (await res.json()) as { text?: string };
      const bodyDoneAt = Date.now();

      // Set transcription result attributes
      const rawText = json?.text ?? '';
      const transcriptionText = stripHallucinations(rawText);
      span.setAttribute('groq.transcription_text', transcriptionText);
      span.setAttribute('groq.raw_text', rawText);
      span.setAttribute('groq.total_duration_ms', bodyDoneAt - startAt);
      span.setAttribute('groq.body_processing_ms', bodyDoneAt - headersAt);

      return {
        text: transcriptionText,
        timings: { startAt, headersAt, bodyDoneAt },
      };
    });
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}
