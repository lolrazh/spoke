import * as Sentry from '@sentry/cloudflare';
import {
  FIREWORKS_STT_TURBO_ENDPOINT,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_TIMEOUT_MS,
} from '../../../config';
import { DEFAULT_STT_PROMPT } from '../prompt';

type BasicTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type FireworksTranscriptionResult = {
  text: string;
  timings: BasicTimings;
};

const FIREWORKS_HOSTNAME = new URL(FIREWORKS_STT_TURBO_ENDPOINT).hostname;

type TranscribeOpts = {
  timeoutMs?: number;
  signal?: AbortSignal;
  language?: string;
  prompt?: string;
  model?: string;
};

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: TranscribeOpts,
): Promise<FireworksTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const model = opts?.model ?? STT_DEFAULT_MODEL;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;
  const prompt = opts?.prompt ?? DEFAULT_STT_PROMPT;

  const endpoint = FIREWORKS_STT_TURBO_ENDPOINT;

  const form = new FormData();
  const file = new File([wav], 'audio.wav', { type: 'audio/wav' });
  form.append('file', file);
  form.append('model', model);
  form.append('language', language);
  form.append('prompt', prompt);

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    return await Sentry.startSpan({
      op: 'http.client',
      name: `POST ${endpoint}`,
      attributes: {
        'http.request.method': 'POST',
        'server.address': FIREWORKS_HOSTNAME,
        'server.port': 443,
        'stt.provider': 'fireworks',
        'fireworks.model': model,
        'fireworks.language': language,
        'audio.size_bytes': wav.length,
        'fireworks.timeout_ms': timeoutMs,
      },
    }, async (span) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: apiKey },
        body: form,
        signal: controller.signal,
      });
      const headersAt = Date.now();

      span.setAttribute('http.response.status_code', res.status);
      span.setAttribute(
        'http.response_content_length',
        Number(res.headers.get('content-length')) || 0,
      );
      span.setAttribute('fireworks.ttfb_ms', headersAt - startAt);

      if (!res.ok) {
        const body = await res.text();
        span.setAttribute('fireworks.error_body', body);
        throw new Error(`FIREWORKS STT error: ${res.status} ${body}`);
      }

      const json = (await res.json()) as { text?: string };
      const bodyDoneAt = Date.now();

      const transcriptionText = json?.text ?? '';
      span.setAttribute('fireworks.transcription_text', transcriptionText);
      span.setAttribute('fireworks.total_duration_ms', bodyDoneAt - startAt);
      span.setAttribute('fireworks.body_processing_ms', bodyDoneAt - headersAt);

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
