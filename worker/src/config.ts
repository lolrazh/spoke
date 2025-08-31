// Centralized config for Worker services

// LLM (Chat Completions)
export const LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const LLM_DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
export const LLM_DEFAULT_TEMPERATURE = 0.2;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;
export const LLM_DEFAULT_STREAM = true;

// STT (Audio Transcriptions)
export const STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const STT_DEFAULT_MODEL = 'whisper-large-v3';
export const STT_DEFAULT_LANGUAGE = 'en';
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
// Default vocab/prompt moved to services/stt/prompt.ts to keep prompts centralized
