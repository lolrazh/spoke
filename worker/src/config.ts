// Centralized config for Worker services

// LLM (Chat Completions)
export const LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// export const LLM_DEFAULT_MODEL = 'gpt-4o';
export const LLM_DEFAULT_MODEL = 'moonshotai/kimi-k2-instruct-0905';
export const LLM_DEFAULT_TEMPERATURE = 0.1;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const LLM_DEFAULT_STREAM = true;
export const OPENAI_LLM_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
// export const LLM_DEFAULT_PROVIDER = 'openai' as const;
export const LLM_DEFAULT_PROVIDER = 'groq' as const;
export type LLMProvider = 'groq' | 'openai';

// STT (Audio Transcriptions)
export const STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const STT_DEFAULT_MODEL = 'whisper-large-v3';
export const STT_DEFAULT_LANGUAGE = 'en';
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
// Default vocab/prompt moved to services/stt/prompt.ts to keep prompts centralized
