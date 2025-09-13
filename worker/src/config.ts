// Centralized config for Worker services

// LLM (Chat Completions)
export const GROQ_LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const OPENAI_LLM_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const CEREBRAS_LLM_ENDPOINT = 'https://inference.baseten.co/v1';
export const LLM_DEFAULT_MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507';
export const LLM_DEFAULT_TEMPERATURE = 0.1;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const LLM_DEFAULT_STREAM = true;
export const LLM_DEFAULT_PROVIDER = 'cerebras' as const;
export type LLMProvider = 'groq' | 'openai' | 'cerebras';

// STT (Audio Transcriptions)
export const STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const STT_DEFAULT_MODEL = 'whisper-large-v3-turbo';
export const STT_DEFAULT_LANGUAGE = 'en';
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
// Default vocab/prompt moved to services/stt/prompt.ts to keep prompts centralized
