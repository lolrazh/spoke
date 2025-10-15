import {
  STT_DEFAULT_MODEL,
  STT_DEFAULT_PROVIDER,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_TIMEOUT_MS,
  FIREWORKS_STT_TURBO_MODEL,
  DEEPGRAM_STT_DEFAULT_MODEL,
  type STTProvider,
} from '../../config';
import { transcribeWav as transcribeGroq } from './providers/groq';
import { transcribeWav as transcribeFireworks } from './providers/fireworks';
import { transcribeWav as transcribeDeepgram } from './providers/deepgram';

type BaseOptions = {
  apiKey: string;
  model?: string;
  language?: string;
  prompt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type TranscribeOptions = BaseOptions & {
  provider?: STTProvider;
};

export type TranscriptionResult = {
  text: string;
  timings: {
    startAt: number;
    headersAt: number;
    bodyDoneAt: number;
  };
};

export async function transcribeWav(
  wav: Uint8Array,
  opts: TranscribeOptions,
): Promise<TranscriptionResult> {
  const provider = opts.provider ?? STT_DEFAULT_PROVIDER;
  const model = opts.model ?? defaultModelFor(provider);
  const language = opts.language ?? STT_DEFAULT_LANGUAGE;
  const timeoutMs = opts.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;

  if (!opts.apiKey) {
    throw new Error(`Missing API key for STT provider: ${provider}`);
  }

  if (provider === 'groq') {
    return transcribeGroq(wav, opts.apiKey, {
      model,
      language,
      prompt: opts.prompt,
      timeoutMs,
      signal: opts.signal,
    });
  }

  if (provider === 'fireworks') {
    return transcribeFireworks(wav, opts.apiKey, {
      model,
      language,
      prompt: opts.prompt,
      timeoutMs,
      signal: opts.signal,
    });
  }

  if (provider === 'deepgram') {
    return transcribeDeepgram(wav, opts.apiKey, {
      model,
      language,
      prompt: opts.prompt,
      timeoutMs,
      signal: opts.signal,
    });
  }

  throw new Error(`Unsupported STT provider: ${String(provider)}`);
}

function defaultModelFor(provider: STTProvider): string {
  if (provider === 'fireworks') return FIREWORKS_STT_TURBO_MODEL;
  if (provider === 'deepgram') return DEEPGRAM_STT_DEFAULT_MODEL;
  return STT_DEFAULT_MODEL;
}
