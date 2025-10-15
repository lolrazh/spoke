import * as Sentry from '@sentry/cloudflare';
import { DEEPGRAM_STT_ENDPOINT, DEEPGRAM_STT_DEFAULT_MODEL, STT_DEFAULT_LANGUAGE, STT_DEFAULT_TIMEOUT_MS } from '../../../config';

type BasicTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type DeepgramTranscriptionResult = {
  text: string;
  timings: BasicTimings;
};

type TranscribeOpts = {
  timeoutMs?: number;
  signal?: AbortSignal;
  language?: string;
  prompt?: string;
  model?: string;
};

const DEEPGRAM_HOSTNAME = new URL(DEEPGRAM_STT_ENDPOINT).hostname;

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: TranscribeOpts,
): Promise<DeepgramTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const model = opts?.model ?? DEEPGRAM_STT_DEFAULT_MODEL;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }

  const endpointUrl = new URL(DEEPGRAM_STT_ENDPOINT);
  endpointUrl.searchParams.set('model', model);
  endpointUrl.searchParams.set('language', language);

  const audioBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);

  try {
    return await Sentry.startSpan(
      {
        op: 'http.client',
        name: `POST ${DEEPGRAM_STT_ENDPOINT}`,
        attributes: {
          'http.request.method': 'POST',
          'server.address': DEEPGRAM_HOSTNAME,
          'server.port': 443,
          'stt.provider': 'deepgram',
          'deepgram.model': model,
          'deepgram.language': language,
          'audio.size_bytes': wav.length,
          'deepgram.timeout_ms': timeoutMs,
        },
      },
      async (span) => {
        const requestUrl = endpointUrl.toString();
        const res = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'audio/wav',
            Accept: 'application/json',
          },
          body: audioBuffer,
          signal: controller.signal,
        });
        const headersAt = Date.now();

        span.setAttribute('http.response.status_code', res.status);
        span.setAttribute(
          'http.response_content_length',
          Number(res.headers.get('content-length')) || 0,
        );
        span.setAttribute('deepgram.ttfb_ms', headersAt - startAt);

        if (!res.ok) {
          const body = await res.text();
          span.setAttribute('deepgram.error_body', body);
          throw new Error(`DEEPGRAM STT error: ${res.status} ${body}`);
        }

        const json = (await res.json()) as Record<string, any>;
        const bodyDoneAt = Date.now();

        const transcriptionText = extractTranscript(json);
        span.setAttribute('deepgram.transcription_text', transcriptionText);
        span.setAttribute('deepgram.total_duration_ms', bodyDoneAt - startAt);
        span.setAttribute('deepgram.body_processing_ms', bodyDoneAt - headersAt);

        return {
          text: transcriptionText,
          timings: { startAt, headersAt, bodyDoneAt },
        };
      },
    );
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}

function extractTranscript(payload: Record<string, any>): string {
  const channel = payload?.results?.channels?.[0];
  const alternatives = Array.isArray(channel?.alternatives) ? channel.alternatives : [];
  const primary = alternatives[0] ?? {};

  const paragraphNodes = primary?.paragraphs?.paragraphs;
  if (Array.isArray(paragraphNodes) && paragraphNodes.length > 0) {
    const paragraphText = paragraphNodes
      .map((p: any) => (typeof p?.transcript === 'string' ? p.transcript.trim() : ''))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (paragraphText.length > 0) return paragraphText;
  }

  const transcriptCandidates = [
    primary?.transcript,
    channel?.transcript,
    payload?.results?.channels?.[0]?.alternatives?.[0]?.text,
    payload?.transcript,
  ];

  for (const candidate of transcriptCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return '';
}
