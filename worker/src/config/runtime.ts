import {
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_STREAM,
  LLM_DEFAULT_TEMPERATURE,
  LLM_DEFAULT_TIMEOUT_MS,
  LLM_DEFAULT_PROVIDER,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_TIMEOUT_MS,
} from '../config';
import type { LLMProvider } from '../config';

type Boolish = string | undefined | null | boolean;

function toBool(v: Boolish, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  const s = (v ?? '').toString().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}



export type RuntimeConfig = {
  llm: {
    enabled: boolean;
    stream: boolean;
    model: string;
    temperature: number;
    timeoutMs: number;
    currentDate: string;
    provider: LLMProvider;
  };
  stt: {
    model: string;
    language: string;
    prompt?: string;
    timeoutMs: number;
  };
};

export function getRuntimeConfig(env: Record<string, any>): RuntimeConfig {
  // LLM
  const enabled = toBool(env.ENABLE_LLM, true);
  const stream = toBool(env.LLM_STREAM, LLM_DEFAULT_STREAM);
  const model = env.LLM_MODEL || LLM_DEFAULT_MODEL;
  const temperature = Number.isFinite(Number(env.LLM_TEMPERATURE))
    ? Number(env.LLM_TEMPERATURE)
    : LLM_DEFAULT_TEMPERATURE;
  const llmTimeoutMs = Number.isFinite(Number(env.LLM_TIMEOUT_MS))
    ? Number(env.LLM_TIMEOUT_MS)
    : LLM_DEFAULT_TIMEOUT_MS;
  const currentDate = (env.LLM_CURRENT_DATE || new Date().toISOString().slice(0, 10)) as string;
  const userDefaultProvider = (env.LLM_DEFAULT_PROVIDER as string) || LLM_DEFAULT_PROVIDER;
  const provider = parseProvider(env.LLM_PROVIDER, userDefaultProvider as LLMProvider);

  // STT
  const sttModel = env.STT_MODEL || STT_DEFAULT_MODEL;
  const sttLanguage = env.STT_LANGUAGE || STT_DEFAULT_LANGUAGE;
  const sttPrompt = env.STT_PROMPT || undefined;
  const sttTimeoutMs = Number.isFinite(Number(env.STT_TIMEOUT_MS))
    ? Number(env.STT_TIMEOUT_MS)
    : STT_DEFAULT_TIMEOUT_MS;

  return {
    llm: { enabled, stream, model, temperature, timeoutMs: llmTimeoutMs, currentDate, provider },
    stt: { model: sttModel, language: sttLanguage, prompt: sttPrompt, timeoutMs: sttTimeoutMs },
  };
}

function parseProvider(v: unknown, fallback: LLMProvider): LLMProvider {
  const s = (v ?? '').toString().toLowerCase();
  if (s === 'groq' || s === 'openai' || s === 'baseten') return s as LLMProvider;
  return fallback;
}
