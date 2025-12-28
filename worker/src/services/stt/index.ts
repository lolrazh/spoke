import {
  STT_DEFAULT_MODEL,
  STT_DEFAULT_PROVIDER,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_TIMEOUT_MS,
  SIMPLISMART_STT_MODEL,
  SIMPLISMART_STT_TURBO_MODEL,
  type STTProvider,
} from "../../config";
import { transcribeWav as transcribeGroq } from "./providers/groq";
import { transcribeWav as transcribeSimplismart } from "./providers/simplismart";
import { stripHallucinations } from "./postprocess";

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

  let result: TranscriptionResult;

  switch (provider) {
    case "simplismart":
      result = await transcribeSimplismart(wav, opts.apiKey, {
        model,
        language,
        prompt: opts.prompt,
        timeoutMs,
        signal: opts.signal,
      });
      break;
    case "groq":
    default:
      result = await transcribeGroq(wav, opts.apiKey, {
        model,
        language,
        prompt: opts.prompt,
        timeoutMs,
        signal: opts.signal,
      });
      break;
  }

  // Apply post-processing to filter out hallucinations
  return {
    ...result,
    text: stripHallucinations(result.text),
  };
}

function defaultModelFor(provider: STTProvider): string {
  if (provider === "simplismart") return SIMPLISMART_STT_MODEL;
  return STT_DEFAULT_MODEL;
}
