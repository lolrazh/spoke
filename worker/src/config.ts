// Centralized config for Worker services

// LLM (Chat Completions)
export const GROQ_LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const OPENAI_LLM_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const BASETEN_LLM_ENDPOINT = 'https://inference.baseten.co/v1/chat/completions';
// export const LLM_DEFAULT_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507'; // Baseten
export const LLM_DEFAULT_MODEL = 'moonshotai/kimi-k2-instruct-0905'; // Groq
// export const LLM_DEFAULT_MODEL = 'ft:gpt-4.1-mini-2025-04-14:personal:sonic-flow-experiment:CFNOEq5J'; // OpenAI
export const LLM_DEFAULT_TEMPERATURE = 0.2;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const LLM_DEFAULT_STREAM = true;
// export const LLM_DEFAULT_PROVIDER = 'baseten' as const;
export const LLM_DEFAULT_PROVIDER = 'groq' as const;
// export const LLM_DEFAULT_PROVIDER = 'openai' as const;
export type LLMProvider = 'groq' | 'openai' | 'baseten';


// STT (Audio Transcriptions)
export const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const FIREWORKS_STT_TURBO_ENDPOINT = 'https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions';
export const FIREWORKS_STT_LARGE_ENDPOINT = 'https://audio-prod.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions';
export const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
export const FIREWORKS_STT_TURBO_MODEL = 'whisper-v3-turbo';
export const FIREWORKS_STT_LARGE_MODEL = 'whisper-v3';
export const FIREWORKS_STT_DEFAULT_VAD_MODEL = 'silero';
export const FIREWORKS_STT_DEFAULT_ALIGNMENT_MODEL = 'tdnn_ffn';
export const FIREWORKS_STT_DEFAULT_PREPROCESSING = 'none';
export const FIREWORKS_STT_DEFAULT_TEMPERATURES = '0.0,0.2,0.4';
export const STT_DEFAULT_MODEL = GROQ_STT_MODEL;
// export const STT_DEFAULT_MODEL = FIREWORKS_STT_TURBO_MODEL;
export const STT_DEFAULT_LANGUAGE = 'en';
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
export const STT_DEFAULT_PROVIDER = 'groq' as const;
// export const STT_DEFAULT_PROVIDER = 'fireworks' as const;
export type STTProvider = 'groq' | 'fireworks';
