// Centralized config for Worker services

// LLM (Chat Completions)
export const LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const LLM_DEFAULT_MODEL = 'openai/gpt-oss-20b';
export const LLM_DEFAULT_TEMPERATURE = 0.2;
export const LLM_DEFAULT_TIMEOUT_MS = 25_000;

// STT (Audio Transcriptions)
export const STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const STT_DEFAULT_MODEL = 'whisper-large-v3';
export const STT_DEFAULT_LANGUAGE = 'en';
export const STT_DEFAULT_TIMEOUT_MS = 25_000;
export const STT_DEFAULT_VOCAB_PROMPT =
  'Your vocabulary includes: Sonic Flow, Sandheep Rajkumar, Groq, Supabase, Gemini 2.0 Flash Lite';

