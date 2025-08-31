export const DEFAULT_STT_PROMPT =
  'Your vocabulary includes: Sonic Flow, Sandheep Rajkumar, rajkumar.sandheep@gmail.com, Groq, Supabase, Gemini 2.0 Flash Lite';

export function buildSTTPrompt(opts?: { extraVocab?: string[]; basePrompt?: string }) {
  const base = (opts?.basePrompt ?? DEFAULT_STT_PROMPT).trim();
  const extra = (opts?.extraVocab ?? []).filter(Boolean);
  if (extra.length === 0) return base;
  return `${base}; plus: ${extra.join(', ')}`;
}
