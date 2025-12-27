export type GroqTranscriptionTimings = {
  startAt: number;
  headersAt: number;
  bodyDoneAt: number;
};

export type GroqTranscriptionResult = {
  text: string;
  timings: GroqTranscriptionTimings;
};

import {
  GROQ_STT_ENDPOINT,
  STT_DEFAULT_MODEL,
  STT_DEFAULT_LANGUAGE,
  STT_DEFAULT_TIMEOUT_MS,
} from "../../../config";
import { DEFAULT_STT_PROMPT } from "../prompt";

export async function transcribeWav(
  wav: Uint8Array,
  apiKey: string,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    language?: string;
    prompt?: string;
    model?: string;
  },
): Promise<GroqTranscriptionResult> {
  const startAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
  const model = opts?.model ?? STT_DEFAULT_MODEL;
  const language = opts?.language ?? STT_DEFAULT_LANGUAGE;
  const prompt = opts?.prompt ?? DEFAULT_STT_PROMPT;

  const form = new FormData();
  const file = new File([wav], "audio.wav", { type: "audio/wav" });
  form.append("file", file);
  form.append("model", model);
  form.append("language", language);
  form.append("prompt", prompt);
  form.append("temperature", "0");

  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(GROQ_STT_ENDPOINT, {
      method: "POST",
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

    const transcriptionText = json?.text ?? "";

    return {
      text: transcriptionText,
      timings: { startAt, headersAt, bodyDoneAt },
    };
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
