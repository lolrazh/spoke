export type CerebrasChatTimings = {
  startAt: number;
  headersAt: number;
  firstDeltaAt?: number;
  bodyDoneAt: number;
};

export type CerebrasChatResult = {
  text: string;
  timings: CerebrasChatTimings;
};

export type ChatCompleteOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  userContent: string;
  stream?: boolean;
  temperature?: number;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
};

import * as Sentry from '@sentry/cloudflare';
import { DEFAULT_LLM_SYSTEM_PROMPT } from './prompt';
import { CEREBRAS_LLM_ENDPOINT, LLM_DEFAULT_MODEL, LLM_DEFAULT_TEMPERATURE, LLM_DEFAULT_TIMEOUT_MS } from '../../config';
import { safeJson } from '../../utils/ws';
import { safely } from '../../utils/safely';

// Cerebras chat completions (OpenAI-compatible) with SSE streaming
export async function chatComplete(opts: ChatCompleteOptions): Promise<CerebrasChatResult> {
  const {
    apiKey,
    model = LLM_DEFAULT_MODEL,
    systemPrompt = DEFAULT_LLM_SYSTEM_PROMPT,
    userContent,
    stream = true,
    temperature = LLM_DEFAULT_TEMPERATURE,
    onDelta,
    timeoutMs = LLM_DEFAULT_TIMEOUT_MS,
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
    return await Sentry.startSpan({
      op: 'http.client',
      name: `POST ${CEREBRAS_LLM_ENDPOINT}`,
      attributes: {
        'http.request.method': 'POST',
        'server.address': 'api.cerebras.ai',
        'server.port': 443,
        'llm.model': model,
        'llm.stream': stream,
        'llm.temperature': temperature,
        'llm.user_content_length': userContent.length,
        'llm.timeout_ms': timeoutMs,
      },
    }, async (span) => {
      const body: any = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        stream,
        temperature,
      };

      const res = await fetch(CEREBRAS_LLM_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const headersAt = Date.now();

      span.setAttribute('http.response.status_code', res.status);
      span.setAttribute('http.response_content_length', Number(res.headers.get('content-length')) || 0);
      span.setAttribute('llm.ttfb_ms', headersAt - startAt);

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        span.setAttribute('llm.error_body', t);
        throw new Error(`Cerebras Chat error: ${res.status} ${t}`);
      }

      if (!stream) {
        const json = (await res.json()) as any;
        const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content ?? '';
        const bodyDoneAt = Date.now();
        span.setAttribute('llm.response_text', content || '');
        span.setAttribute('llm.total_duration_ms', bodyDoneAt - startAt);
        span.setAttribute('llm.body_processing_ms', bodyDoneAt - headersAt);
        span.setAttribute('llm.response_length', (content || '').length);
        return { text: content || '', timings: { startAt, headersAt, bodyDoneAt } };
      }

      // SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Cerebras Chat streaming not supported: missing body reader');
      let buf = '';
      let out = '';
      let firstDeltaAt: number | undefined = undefined;
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (;;) {
          const idx = buf.indexOf('\n');
          if (idx === -1) break;
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            const obj = safeJson<any>(data);
            if (!obj) continue;
            const choice = obj?.choices?.[0];
            const delta = choice?.delta?.content ?? '';
            if (delta) {
              if (!firstDeltaAt) firstDeltaAt = Date.now();
              out += delta;
              if (onDelta) safely(() => onDelta(delta));
            }
          }
        }
      }
      const bodyDoneAt = Date.now();
      span.setAttribute('llm.response_text', out);
      span.setAttribute('llm.total_duration_ms', bodyDoneAt - startAt);
      span.setAttribute('llm.first_delta_ms', firstDeltaAt ? firstDeltaAt - startAt : null);
      span.setAttribute('llm.body_processing_ms', bodyDoneAt - (firstDeltaAt ?? headersAt));
      span.setAttribute('llm.response_length', out.length);
      span.setAttribute('llm.streaming', true);
      return { text: out, timings: { startAt, headersAt, firstDeltaAt, bodyDoneAt } };
    });
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

