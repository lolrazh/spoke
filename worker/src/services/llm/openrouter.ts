export type OpenRouterChatTimings = {
  startAt: number;
  headersAt: number;
  firstDeltaAt?: number;
  bodyDoneAt: number;
};

export type OpenRouterChatResult = {
  text: string;
  timings: OpenRouterChatTimings;
};

export type OpenRouterProviderPreferences = {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: 'allow' | 'deny';
  zdr?: boolean;
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: 'price' | 'throughput' | 'latency';
  max_price?: Record<string, number>;
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
  providerConfig?: Record<string, any>;
  extraHeaders?: Record<string, string>;
};

import * as Sentry from '@sentry/cloudflare';
import { DEFAULT_LLM_SYSTEM_PROMPT } from './prompt';
import {
  OPENROUTER_LLM_ENDPOINT,
  OPENROUTER_LLM_DEFAULT_MODEL,
  LLM_DEFAULT_TEMPERATURE,
  LLM_DEFAULT_TIMEOUT_MS,
} from '../../config';
import { safeJson } from '../../utils/ws';
import { safely } from '../../utils/safely';

const DEFAULT_PROVIDER_CONFIG: OpenRouterProviderPreferences = {
  sort: 'latency',
};

export async function chatComplete(opts: ChatCompleteOptions): Promise<OpenRouterChatResult> {
  const {
    apiKey,
    model = OPENROUTER_LLM_DEFAULT_MODEL,
    systemPrompt = DEFAULT_LLM_SYSTEM_PROMPT,
    userContent,
    stream = true,
    temperature = LLM_DEFAULT_TEMPERATURE,
    onDelta,
    timeoutMs = LLM_DEFAULT_TIMEOUT_MS,
    signal,
    providerConfig,
    extraHeaders,
  } = opts;

  const providerPreferences: OpenRouterProviderPreferences = {
    ...DEFAULT_PROVIDER_CONFIG,
    ...(providerConfig as OpenRouterProviderPreferences | undefined),
  };

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
      name: `POST ${OPENROUTER_LLM_ENDPOINT}`,
      attributes: {
        'http.request.method': 'POST',
        'server.address': 'openrouter.ai',
        'server.port': 443,
        'llm.model': model,
        'llm.stream': stream,
        'llm.temperature': temperature,
        'llm.user_content_length': userContent.length,
        'llm.timeout_ms': timeoutMs,
        'llm.provider.sort': providerPreferences.sort ?? 'latency',
      },
    }, async (span) => {
      const body: Record<string, any> = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        stream,
        temperature,
        provider: providerPreferences,
      };

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(extraHeaders ?? {}),
      };

      const res = await fetch(OPENROUTER_LLM_ENDPOINT, {
        method: 'POST',
        headers,
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
        throw new Error(`OpenRouter Chat error: ${res.status} ${t}`);
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

      const reader = res.body?.getReader();
      if (!reader) throw new Error('OpenRouter Chat streaming not supported: missing body reader');
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
