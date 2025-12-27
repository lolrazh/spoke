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

import {
  CEREBRAS_LLM_ENDPOINT,
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_TEMPERATURE,
  LLM_DEFAULT_TIMEOUT_MS,
} from "../../config";
import { safeJson } from "../../utils/ws";
import { safely } from "../../utils/safely";

// Cerebras chat completions (OpenAI-compatible) with SSE streaming
export async function chatComplete(
  opts: ChatCompleteOptions,
): Promise<CerebrasChatResult> {
  const {
    apiKey,
    model = LLM_DEFAULT_MODEL,
    systemPrompt = "",
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
    else signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const body: any = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      stream,
      temperature,
    };

    const res = await fetch(CEREBRAS_LLM_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const headersAt = Date.now();

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Cerebras Chat error: ${res.status} ${t}`);
    }

    if (!stream) {
      const json = (await res.json()) as any;
      const content =
        json?.choices?.[0]?.message?.content ??
        json?.choices?.[0]?.delta?.content ??
        "";
      const bodyDoneAt = Date.now();
      return {
        text: content || "",
        timings: { startAt, headersAt, bodyDoneAt },
      };
    }

    const reader = res.body?.getReader();
    if (!reader)
      throw new Error(
        "Cerebras Chat streaming not supported: missing body reader",
      );
    let buf = "";
    let out = "";
    let firstDeltaAt: number | undefined = undefined;
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const idx = buf.indexOf("\n");
        if (idx === -1) break;
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const obj = safeJson<any>(data);
          if (!obj) continue;
          const choice = obj?.choices?.[0];
          const delta = choice?.delta?.content ?? "";
          if (delta) {
            if (!firstDeltaAt) firstDeltaAt = Date.now();
            out += delta;
            if (onDelta) safely(() => onDelta(delta));
          }
        }
      }
    }
    const bodyDoneAt = Date.now();
    return {
      text: out,
      timings: { startAt, headersAt, firstDeltaAt, bodyDoneAt },
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}
