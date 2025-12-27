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

  // Granular timing: FormData creation
  const formStartAt = Date.now();
  const form = new FormData();
  const file = new File([wav], "audio.wav", { type: "audio/wav" });
  form.append("file", file);
  form.append("model", model);
  form.append("language", language);
  form.append("prompt", prompt);
  form.append("temperature", "0");
  const formCreationMs = Date.now() - formStartAt;

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
    // Granular timing: Fetch call
    const fetchStartAt = Date.now();
    const res = await fetch(GROQ_STT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const headersAt = Date.now();
    const fetchTtfbMs = headersAt - fetchStartAt;

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GROQ STT error: ${res.status} ${body}`);
    }

    const json = (await res.json()) as { text?: string };
    const bodyDoneAt = Date.now();
    const bodyReadMs = bodyDoneAt - headersAt;

    const transcriptionText = json?.text ?? "";

    // Total timing breakdown
    const totalMs = bodyDoneAt - startAt;
    const totalFetchMs = bodyDoneAt - fetchStartAt;

    // Log granular breakdown to identify where time is spent
    console.log(`[STT:Groq] Latency breakdown:`, {
      audio_size_kb: (wav.length / 1024).toFixed(2),
      timings: {
        form_creation_ms: formCreationMs, // Time to create FormData + File object
        fetch_ttfb_ms: fetchTtfbMs, // Time from fetch() to headers received (DNS + TCP + TLS + upload + server)
        body_read_ms: bodyReadMs, // Time to download response body + parse JSON
        total_fetch_ms: totalFetchMs, // Pure fetch time (excludes form creation)
        total_ms: totalMs, // Everything from function entry to body parsed
      },
      // If fetch_ttfb_ms >> AI Gateway reported time, the delta is:
      // DNS + TCP/TLS handshake + request upload time
    });

    return {
      text: transcriptionText,
      timings: { startAt, headersAt, bodyDoneAt },
    };
  } finally {
    clearTimeout(timeoutId);
    if (opts?.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
