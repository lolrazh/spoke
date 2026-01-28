import { buildSTTPrompt } from "../services/stt/prompt";
import { logSessionSTT } from "../utils/sessionLogger";
import type { TranscribeResult } from "./types";
import type { RuntimeConfig } from "./types";

/**
 * Transcribes Opus/webm audio directly without WAV conversion
 *
 * Used by HTTP /transcribe endpoint which receives audio from MediaRecorder.
 * Groq accepts webm/opus natively, no conversion needed.
 */
export async function transcribeOpus(
  audioBlob: Blob,
  options: {
    runtime: RuntimeConfig;
    env: { GROQ_API_KEY?: string; SIMPLISMART_API_KEY?: string };
    identity?: string;
    ocrWords?: string[];
    language?: string;
    signal?: AbortSignal;
    traceId: string;
  },
): Promise<TranscribeResult> {
  const { runtime, env, identity, ocrWords, language, signal, traceId } =
    options;

  // Build STT prompt with context
  const sttPrompt = buildSTTPrompt({
    basePrompt: runtime.stt.prompt,
    identity,
    ocrWords: ocrWords && ocrWords.length > 0 ? ocrWords : undefined,
  });

  // Get API key
  const apiKey =
    runtime.stt.provider === "simplismart"
      ? env.SIMPLISMART_API_KEY
      : env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      `Missing API key for STT provider: ${runtime.stt.provider}`,
    );
  }

  // Create FormData with audio blob
  const form = new FormData();
  const file = new File([audioBlob], "audio.webm", {
    type: audioBlob.type || "audio/webm",
  });
  form.append("file", file);
  form.append("model", runtime.stt.model);
  form.append("language", language || runtime.stt.language);
  form.append("prompt", sttPrompt);
  form.append("temperature", "0");

  // Create abort controller
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, runtime.stt.timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const sttStartTime = Date.now();

    // Call STT API (Groq or SimpliSmart)
    const endpoint =
      runtime.stt.provider === "simplismart"
        ? "https://api.simplismart.ai/v1/audio/transcriptions" // TODO: Import from config
        : "https://api.groq.com/openai/v1/audio/transcriptions"; // TODO: Import from config

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    const headersAt = Date.now();

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`STT error: ${res.status} ${body}`);
    }

    const json = (await res.json()) as { text?: string };
    const bodyDoneAt = Date.now();
    const sttDuration = bodyDoneAt - sttStartTime;
    const ttfb = headersAt - sttStartTime;

    const text = json?.text ?? "";

    // Log STT completion
    logSessionSTT({
      outcome: "success",
      provider: runtime.stt.provider,
      model: runtime.stt.model,
      duration_ms: sttDuration,
      ttfb_ms: ttfb,
      text_length: text.length,
      trace_id: traceId,
    });

    return {
      text,
      timings: { startAt: sttStartTime, headersAt, bodyDoneAt },
      provider: runtime.stt.provider,
      model: runtime.stt.model,
    };
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}
