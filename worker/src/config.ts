// Centralized config for Worker services

// LLM (Chat Completions)
export const GROQ_LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const OPENAI_LLM_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const BASETEN_LLM_ENDPOINT = 'https://inference.baseten.co/v1/chat/completions';
export const OPENROUTER_LLM_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export const GROQ_LLM_DEFAULT_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';
export const GROQ_EDIT_LLM_DEFAULT_MODEL = 'moonshotai/kimi-k2-instruct-0905';
export const OPENAI_LLM_DEFAULT_MODEL = 'gpt-4.1-mini';
export const BASETEN_LLM_DEFAULT_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507';
export const OPENROUTER_LLM_DEFAULT_MODEL = 'qwen/qwen3-235b-a22b-2507';

export const LLM_DEFAULT_MODEL = GROQ_LLM_DEFAULT_MODEL;
export const LLM_DEFAULT_TEMPERATURE = 0.2;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const LLM_DEFAULT_STREAM = true;
export const LLM_DEFAULT_PROVIDER = 'groq' as const;
export type LLMProvider = 'groq' | 'openai' | 'baseten' | 'openrouter';

export const EDIT_LLM_DEFAULT_MODEL = GROQ_EDIT_LLM_DEFAULT_MODEL;
export const EDIT_LLM_DEFAULT_TEMPERATURE = 0.6;
export const EDIT_LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const EDIT_LLM_DEFAULT_STREAM = true;
export const EDIT_LLM_DEFAULT_PROVIDER = 'groq' as const;


// STT (Audio Transcriptions)
export const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const FIREWORKS_STT_TURBO_ENDPOINT = 'https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions';
export const FIREWORKS_STT_LARGE_ENDPOINT = 'https://audio-prod.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions';

export const GROQ_STT_MODEL = 'whisper-large-v3';
export const FIREWORKS_STT_TURBO_MODEL = 'whisper-v3-turbo';
export const FIREWORKS_STT_LARGE_MODEL = 'whisper-v3';

export const STT_DEFAULT_MODEL = GROQ_STT_MODEL;
export const FIREWORKS_STT_DEFAULT_VAD_MODEL = 'silero';
export const FIREWORKS_STT_DEFAULT_ALIGNMENT_MODEL = 'tdnn_ffn';
export const FIREWORKS_STT_DEFAULT_PREPROCESSING = 'none';
export const FIREWORKS_STT_DEFAULT_TEMPERATURES = '0.0,0.2,0.4';

export const STT_DEFAULT_LANGUAGE = 'en';
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
export const STT_DEFAULT_PROVIDER = 'groq' as const;
export type STTProvider = 'groq' | 'fireworks';
