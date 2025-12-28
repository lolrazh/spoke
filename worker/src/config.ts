// Centralized config for Worker services

// LLM (Chat Completions)
export const GROQ_LLM_ENDPOINT =
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/spoke/groq/chat/completions";
export const OPENAI_LLM_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const BASETEN_LLM_ENDPOINT =
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/spoke/baseten/v1/chat/completions";
export const OPENROUTER_LLM_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";
export const CEREBRAS_LLM_ENDPOINT =
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/spoke/cerebras/chat/completions";
export const SIMPLISMART_LLM_ENDPOINT =
  "https://api.simplismart.live/chat/completions";

export const GROQ_LLM_DEFAULT_MODEL =
  "meta-llama/llama-4-maverick-17b-128e-instruct";
export const GROQ_ADVANCED_LLM_DEFAULT_MODEL =
  "moonshotai/kimi-k2-instruct-0905";
export const GROQ_EDIT_LLM_DEFAULT_MODEL = "moonshotai/kimi-k2-instruct-0905";
export const OPENAI_LLM_DEFAULT_MODEL = "gpt-4.1-mini";
export const OPENAI_ADVANCED_LLM_DEFAULT_MODEL = "gpt-4.1-mini";
export const OPENAI_EDIT_LLM_DEFAULT_MODEL = "gpt-4.1-mini";
export const BASETEN_LLM_DEFAULT_MODEL = "deepseek-ai/DeepSeek-V3.2";
export const BASETEN_ADVANCED_LLM_DEFAULT_MODEL =
  "moonshotai/Kimi-K2-Instruct-0905";
export const BASETEN_EDIT_LLM_DEFAULT_MODEL =
  "moonshotai/Kimi-K2-Instruct-0905";
export const OPENROUTER_LLM_DEFAULT_MODEL = "qwen/qwen3-235b-a22b-2507";
export const OPENROUTER_ADVANCED_LLM_DEFAULT_MODEL =
  "qwen/qwen3-235b-a22b-2507";
export const OPENROUTER_EDIT_LLM_DEFAULT_MODEL = "qwen/qwen3-235b-a22b-2507";
export const CEREBRAS_LLM_DEFAULT_MODEL = "llama-3.3-70b";
export const CEREBRAS_ADVANCED_LLM_DEFAULT_MODEL =
  "qwen-3-235b-a22b-instruct-2507";
export const CEREBRAS_EDIT_LLM_DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";
export const SIMPLISMART_LLM_DEFAULT_MODEL = "google/gemma-3-27b-it";
export const SIMPLISMART_ADVANCED_LLM_DEFAULT_MODEL = "google/gemma-3-27b-it";
export const SIMPLISMART_EDIT_LLM_DEFAULT_MODEL = "google/gemma-3-27b-it";
export const SIMPLISMART_LLM_MODEL_UUID =
  "23a8dfd7-f6d4-426c-b637-517c205282c7";

export const LLM_DEFAULT_MODEL = BASETEN_LLM_DEFAULT_MODEL;
export const LLM_DEFAULT_TEMPERATURE = 0.2;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const LLM_DEFAULT_STREAM = false;
export const LLM_DEFAULT_PROVIDER = "baseten" as const;
export const LLM_ROUTER_ENABLED = true;
export type LLMProvider =
  | "groq"
  | "openai"
  | "baseten"
  | "openrouter"
  | "cerebras"
  | "simplismart";

export const EDIT_LLM_DEFAULT_MODEL = BASETEN_EDIT_LLM_DEFAULT_MODEL;
export const EDIT_LLM_DEFAULT_TEMPERATURE = 0.6;
export const EDIT_LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const EDIT_LLM_DEFAULT_STREAM = false;
export const EDIT_LLM_DEFAULT_PROVIDER = "baseten" as const;

export const ADVANCED_LLM_DEFAULT_MODEL = BASETEN_ADVANCED_LLM_DEFAULT_MODEL;
export const ADVANCED_LLM_DEFAULT_TEMPERATURE = 0.3;
export const ADVANCED_LLM_DEFAULT_TIMEOUT_MS = 30_000;
export const ADVANCED_LLM_DEFAULT_STREAM = false;
export const ADVANCED_LLM_DEFAULT_PROVIDER = "baseten" as const;

// STT (Audio Transcriptions)
export const GROQ_STT_ENDPOINT =
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/spoke/groq/audio/transcriptions";
export const FIREWORKS_STT_TURBO_ENDPOINT =
  "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions";
export const FIREWORKS_STT_LARGE_ENDPOINT =
  "https://audio-prod.api.fireworks.ai/v1/audio/transcriptions";
export const DEEPGRAM_STT_ENDPOINT = "https://api.deepgram.com/v1/listen";
export const SIMPLISMART_STT_ENDPOINT =
  "https://http.zkbxe6nuy2.ss-in.s9t.link/predict";
export const SIMPLISMART_STT_TURBO_ENDPOINT =
  "https://http.au163kpw51.ss-in.s9t.link/predict";

export const GROQ_STT_MODEL = "whisper-large-v3";
export const FIREWORKS_STT_TURBO_MODEL = "whisper-v3-turbo";
export const FIREWORKS_STT_LARGE_MODEL = "whisper-v3";
export const DEEPGRAM_STT_DEFAULT_MODEL = "nova-3";
export const SIMPLISMART_STT_MODEL = "whisper";
export const SIMPLISMART_STT_TURBO_MODEL = "whisper-turbo";

export const STT_DEFAULT_MODEL = GROQ_STT_MODEL;
export const FIREWORKS_STT_DEFAULT_VAD_MODEL = "silero";
export const FIREWORKS_STT_DEFAULT_ALIGNMENT_MODEL = "tdnn_ffn";
export const FIREWORKS_STT_DEFAULT_PREPROCESSING = "none";
export const FIREWORKS_STT_DEFAULT_TEMPERATURES = "0.0,0.2,0.4";

export const STT_DEFAULT_LANGUAGE = "en";
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
export const STT_DEFAULT_PROVIDER = "groq" as const;
export type STTProvider = "groq" | "fireworks" | "deepgram" | "simplismart";

// OCR (Vision Model)
export const GROQ_OCR_ENDPOINT =
  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/spoke/groq/chat/completions";
export const GROQ_OCR_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
export const OCR_DEFAULT_PROVIDER = "groq" as const;
export const OCR_DEFAULT_TIMEOUT_MS = 5000;
export const OCR_MAX_WORDS = 50;