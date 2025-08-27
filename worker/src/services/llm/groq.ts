export type GroqChatTimings = {
  startAt: number;
  headersAt: number;
  firstDeltaAt?: number;
  bodyDoneAt: number;
};

export type GroqChatResult = {
  text: string;
  timings: GroqChatTimings;
};

export type ChatCompleteOptions = {
  apiKey: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  systemPrompt?: string;
  userContent: string;
  stream?: boolean;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function chatComplete(opts: ChatCompleteOptions): Promise<GroqChatResult> {
  const {
    apiKey,
    model = 'openai/gpt-oss-20b',
    reasoningEffort,
    systemPrompt =
      'You are a fast editor for ASR output. Preserve meaning, fix punctuation and casing, split into readable sentences, and keep names/terms intact. Do not summarize.',
    userContent,
    stream = false,
    onDelta,
    timeoutMs = 25_000,
    signal,
  } = opts;

  const startAt = Date.now();
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const body: any = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream,
      temperature: 0.2,
    };
    if (reasoningEffort) {
      // Groq uses top-level `reasoning_effort`
      body.reasoning_effort = reasoningEffort;
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const headersAt = Date.now();
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`GROQ Chat error: ${res.status} ${t}`);
    }

    if (!stream) {
      const json = (await res.json()) as any;
      const content =
        json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content ?? '';
      const bodyDoneAt = Date.now();
      return { text: content || '', timings: { startAt, headersAt, bodyDoneAt } };
    }

    // Streamed SSE response
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('GROQ Chat streaming not supported: missing body reader');
    }
    let buf = '';
    let out = '';
    let firstDeltaAt: number | undefined = undefined;
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Process complete lines
      for (;;) {
        const idx = buf.indexOf('\n');
        if (idx === -1) break;
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            // end
            continue;
          }
          try {
            const obj = JSON.parse(data);
            const choice = obj?.choices?.[0];
            const delta = choice?.delta?.content ?? '';
            if (delta) {
              if (!firstDeltaAt) firstDeltaAt = Date.now();
              out += delta;
              if (onDelta) {
                try { onDelta(delta); } catch {}
              }
            }
          } catch (e) {
            // ignore parse errors for keep-alive or non-data lines
          }
        }
      }
    }
    const bodyDoneAt = Date.now();
    return { text: out, timings: { startAt, headersAt, firstDeltaAt, bodyDoneAt } };
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
