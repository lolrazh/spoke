import {
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_STREAM,
  LLM_DEFAULT_TEMPERATURE,
  LLM_DEFAULT_TIMEOUT_MS,
  LLM_DEFAULT_PROVIDER,
  LLM_ROUTER_ENABLED,
  GROQ_LLM_DEFAULT_MODEL,
  OPENAI_LLM_DEFAULT_MODEL,
  BASETEN_LLM_DEFAULT_MODEL,
  OPENROUTER_LLM_DEFAULT_MODEL,
  CEREBRAS_LLM_DEFAULT_MODEL,
  SIMPLISMART_LLM_DEFAULT_MODEL,
  GROQ_ADVANCED_LLM_DEFAULT_MODEL,
  OPENAI_ADVANCED_LLM_DEFAULT_MODEL,
  BASETEN_ADVANCED_LLM_DEFAULT_MODEL,
  OPENROUTER_ADVANCED_LLM_DEFAULT_MODEL,
  CEREBRAS_ADVANCED_LLM_DEFAULT_MODEL,
  SIMPLISMART_ADVANCED_LLM_DEFAULT_MODEL,
  GROQ_EDIT_LLM_DEFAULT_MODEL,
  OPENAI_EDIT_LLM_DEFAULT_MODEL,
  BASETEN_EDIT_LLM_DEFAULT_MODEL,
  OPENROUTER_EDIT_LLM_DEFAULT_MODEL,
  CEREBRAS_EDIT_LLM_DEFAULT_MODEL,
  SIMPLISMART_EDIT_LLM_DEFAULT_MODEL,
  ADVANCED_LLM_DEFAULT_MODEL,
  ADVANCED_LLM_DEFAULT_PROVIDER,
  ADVANCED_LLM_DEFAULT_TEMPERATURE,
  ADVANCED_LLM_DEFAULT_TIMEOUT_MS,
  ADVANCED_LLM_DEFAULT_STREAM,
  EDIT_LLM_DEFAULT_MODEL,
  EDIT_LLM_DEFAULT_PROVIDER,
  EDIT_LLM_DEFAULT_TEMPERATURE,
  EDIT_LLM_DEFAULT_TIMEOUT_MS,
  EDIT_LLM_DEFAULT_STREAM,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_TIMEOUT_MS,
  STT_DEFAULT_PROVIDER,
  FIREWORKS_STT_TURBO_MODEL,
  DEEPGRAM_STT_DEFAULT_MODEL,
  SIMPLISMART_STT_MODEL,
  SIMPLISMART_STT_TURBO_MODEL,
} from "../config";
import type { LLMProvider, STTProvider } from "../config";

type Boolish = string | undefined | null | boolean;

function toBool(v: Boolish, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = (v ?? "").toString().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return fallback;
}

const PROVIDER_DEFAULT_MODELS: Record<LLMProvider, string> = {
  groq: GROQ_LLM_DEFAULT_MODEL,
  openai: OPENAI_LLM_DEFAULT_MODEL,
  baseten: BASETEN_LLM_DEFAULT_MODEL,
  openrouter: OPENROUTER_LLM_DEFAULT_MODEL,
  cerebras: CEREBRAS_LLM_DEFAULT_MODEL,
  simplismart: SIMPLISMART_LLM_DEFAULT_MODEL,
};

const PROVIDER_ADVANCED_MODELS: Record<LLMProvider, string> = {
  groq: GROQ_ADVANCED_LLM_DEFAULT_MODEL,
  openai: OPENAI_ADVANCED_LLM_DEFAULT_MODEL,
  baseten: BASETEN_ADVANCED_LLM_DEFAULT_MODEL,
  openrouter: OPENROUTER_ADVANCED_LLM_DEFAULT_MODEL,
  cerebras: CEREBRAS_ADVANCED_LLM_DEFAULT_MODEL,
  simplismart: SIMPLISMART_ADVANCED_LLM_DEFAULT_MODEL,
};

const PROVIDER_EDIT_MODELS: Record<LLMProvider, string> = {
  groq: GROQ_EDIT_LLM_DEFAULT_MODEL,
  openai: OPENAI_EDIT_LLM_DEFAULT_MODEL,
  baseten: BASETEN_EDIT_LLM_DEFAULT_MODEL,
  openrouter: OPENROUTER_EDIT_LLM_DEFAULT_MODEL,
  cerebras: CEREBRAS_EDIT_LLM_DEFAULT_MODEL,
  simplismart: SIMPLISMART_EDIT_LLM_DEFAULT_MODEL,
};

function defaultModelFor(provider: LLMProvider, fallback: string): string {
  return PROVIDER_DEFAULT_MODELS[provider] ?? fallback;
}

function defaultAdvancedModelFor(
  provider: LLMProvider,
  fallback: string,
): string {
  return PROVIDER_ADVANCED_MODELS[provider] ?? fallback;
}

function defaultEditModelFor(provider: LLMProvider, fallback: string): string {
  return PROVIDER_EDIT_MODELS[provider] ?? fallback;
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
    routerEnabled: boolean;
  };
  stt: {
    provider: STTProvider;
    model: string;
    language: string;
    prompt?: string;
    timeoutMs: number;
  };
  advanced: {
    enabled: boolean;
    stream: boolean;
    model: string;
    temperature: number;
    timeoutMs: number;
    provider: LLMProvider;
  };
  edit: {
    enabled: boolean;
    stream: boolean;
    model: string;
    temperature: number;
    timeoutMs: number;
    provider: LLMProvider;
  };
};

export function getRuntimeConfig(env: Record<string, any>): RuntimeConfig {
  // LLM
  const enabled = toBool(env.ENABLE_LLM, true);
  const stream = toBool(env.LLM_STREAM, LLM_DEFAULT_STREAM);
  const userDefaultProvider =
    (env.LLM_DEFAULT_PROVIDER as string) || LLM_DEFAULT_PROVIDER;
  const provider = parseProvider(
    env.LLM_PROVIDER,
    userDefaultProvider as LLMProvider,
  );
  const model = env.LLM_MODEL || defaultModelFor(provider, LLM_DEFAULT_MODEL);
  const temperature = Number.isFinite(Number(env.LLM_TEMPERATURE))
    ? Number(env.LLM_TEMPERATURE)
    : LLM_DEFAULT_TEMPERATURE;
  const llmTimeoutMs = Number.isFinite(Number(env.LLM_TIMEOUT_MS))
    ? Number(env.LLM_TIMEOUT_MS)
    : LLM_DEFAULT_TIMEOUT_MS;
  const currentDate = (env.LLM_CURRENT_DATE ||
    new Date().toISOString().slice(0, 10)) as string;
  const routerEnabled = toBool(env.LLM_ROUTER_ENABLED, LLM_ROUTER_ENABLED);

  // STT
  const sttProvider = parseSttProvider(env.STT_PROVIDER, STT_DEFAULT_PROVIDER);
  const sttModel = env.STT_MODEL || defaultSttModelFor(sttProvider);
  const sttLanguage = env.STT_LANGUAGE || STT_DEFAULT_LANGUAGE;
  const sttPrompt = env.STT_PROMPT || undefined;
  const sttTimeoutMs = Number.isFinite(Number(env.STT_TIMEOUT_MS))
    ? Number(env.STT_TIMEOUT_MS)
    : STT_DEFAULT_TIMEOUT_MS;

  // Advanced LLM (for complex/long transcriptions, separate from edit)
  const advancedEnabled = toBool(env.ADVANCED_LLM_ENABLED, true);
  const advancedStream = toBool(
    env.ADVANCED_LLM_STREAM,
    ADVANCED_LLM_DEFAULT_STREAM,
  );
  const advancedProvider = parseProvider(
    env.ADVANCED_LLM_PROVIDER,
    ADVANCED_LLM_DEFAULT_PROVIDER,
  );
  const advancedModel =
    env.ADVANCED_LLM_MODEL ||
    defaultAdvancedModelFor(advancedProvider, ADVANCED_LLM_DEFAULT_MODEL);
  const advancedTemperature = Number.isFinite(
    Number(env.ADVANCED_LLM_TEMPERATURE),
  )
    ? Number(env.ADVANCED_LLM_TEMPERATURE)
    : ADVANCED_LLM_DEFAULT_TEMPERATURE;
  const advancedTimeoutMs = Number.isFinite(Number(env.ADVANCED_LLM_TIMEOUT_MS))
    ? Number(env.ADVANCED_LLM_TIMEOUT_MS)
    : ADVANCED_LLM_DEFAULT_TIMEOUT_MS;

  // Edit LLM (only for edit mode with selected text)
  const editEnabled = toBool(env.EDIT_LLM_ENABLED, true);
  const editStream = toBool(env.EDIT_LLM_STREAM, EDIT_LLM_DEFAULT_STREAM);
  const editProvider = parseProvider(
    env.EDIT_LLM_PROVIDER,
    EDIT_LLM_DEFAULT_PROVIDER,
  );
  const editModel =
    env.EDIT_LLM_MODEL ||
    defaultEditModelFor(editProvider, EDIT_LLM_DEFAULT_MODEL);
  const editTemperature = Number.isFinite(Number(env.EDIT_LLM_TEMPERATURE))
    ? Number(env.EDIT_LLM_TEMPERATURE)
    : EDIT_LLM_DEFAULT_TEMPERATURE;
  const editTimeoutMs = Number.isFinite(Number(env.EDIT_LLM_TIMEOUT_MS))
    ? Number(env.EDIT_LLM_TIMEOUT_MS)
    : EDIT_LLM_DEFAULT_TIMEOUT_MS;

  return {
    llm: {
      enabled,
      stream,
      model,
      temperature,
      timeoutMs: llmTimeoutMs,
      currentDate,
      provider,
      routerEnabled,
    },
    stt: {
      provider: sttProvider,
      model: sttModel,
      language: sttLanguage,
      prompt: sttPrompt,
      timeoutMs: sttTimeoutMs,
    },
    advanced: {
      enabled: advancedEnabled,
      stream: advancedStream,
      model: advancedModel,
      temperature: advancedTemperature,
      timeoutMs: advancedTimeoutMs,
      provider: advancedProvider,
    },
    edit: {
      enabled: editEnabled,
      stream: editStream,
      model: editModel,
      temperature: editTemperature,
      timeoutMs: editTimeoutMs,
      provider: editProvider,
    },
  };
}

function parseProvider(v: unknown, fallback: LLMProvider): LLMProvider {
  const s = (v ?? "").toString().toLowerCase();
  if (
    s === "groq" ||
    s === "openai" ||
    s === "baseten" ||
    s === "openrouter" ||
    s === "cerebras" ||
    s === "simplismart"
  )
    return s as LLMProvider;
  return fallback;
}

function parseSttProvider(v: unknown, fallback: STTProvider): STTProvider {
  const s = (v ?? "").toString().toLowerCase();
  if (
    s === "groq" ||
    s === "fireworks" ||
    s === "deepgram" ||
    s === "simplismart"
  )
    return s as STTProvider;
  return fallback;
}

function defaultSttModelFor(provider: STTProvider): string {
  if (provider === "fireworks") return FIREWORKS_STT_TURBO_MODEL;
  if (provider === "deepgram") return DEEPGRAM_STT_DEFAULT_MODEL;
  return STT_DEFAULT_MODEL;
}
