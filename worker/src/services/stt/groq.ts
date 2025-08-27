export type GroqTranscriptionTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type GroqTranscriptionResult = {
  text: string;
  timings: GroqTranscriptionTimings;
};

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal; language?: string; prompt?: string; model?: string },
): Promise<GroqTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 25_000;
  const model = opts?.model ?? 'whisper-large-v3';
  const language = opts?.language ?? 'en';
  const prompt = opts?.prompt ??
    'Your vocabulary includes: Sonic Flow, Sandheep Rajkumar, Groq, Supabase, Gemini 2.0 Flash Lite';

  const form = new FormData();
  const file = new File([wav], 'audio.wav', { type: 'audio/wav' });
  form.append('file', file);
  form.append('model', model);
  form.append('language', language);
  form.append('prompt', prompt);

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const headersAt = Date.now();
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GROQ STT error: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { text?: string };
    const bodyDoneAt = Date.now();
    return {
      text: json?.text ?? '',
      timings: { startAt, headersAt, bodyDoneAt },
    };
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}

