import { concat, wrapWav } from "../audio/codec";
import { transcribeWav } from "../services/stt";
import { buildSTTPrompt } from "../services/stt/prompt";
import { logSessionAudio, logSessionSTT } from "../utils/sessionLogger";
import type { ConnectionContext, TranscribeResult } from "./types";
import type { RuntimeConfig } from "./types";

/**
 * Assembles WAV from accumulated chunks and calls STT
 */
export async function transcribe(
  ctx: ConnectionContext,
): Promise<TranscribeResult | null> {
  const { session, runtime, env } = ctx;

  // Early return for empty/canceled sessions
  if (
    session.canceled ||
    session.chunks.length === 0 ||
    session.totalBytes === 0
  ) {
    return null;
  }

  // Assemble WAV
  const assembleStart = Date.now();
  const pcm = concat(session.chunks, session.totalBytes);
  const wav = wrapWav(pcm, session.rate, 1, 16);

  // Release memory early
  session.chunks = [];

  ctx.timing.assembleMs = Date.now() - assembleStart;

  // Log audio stats
  logSessionAudio({
    frames: session.frames,
    bytes_kb: Number((session.totalBytes / 1024).toFixed(2)),
    streaming_duration_ms:
      session.firstArrivalMs && session.lastArrivalMs
        ? session.lastArrivalMs - session.firstArrivalMs
        : null,
    seq_gaps: session.seqGaps,
    trace_id: session.traceId ?? "unknown",
  });

  // Build STT prompt with context
  const sttPrompt = buildSTTPrompt({
    basePrompt: runtime.stt.prompt,
    identity: session.identity,
    ocrWords: session.ocrWords.length > 0 ? session.ocrWords : undefined,
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

  // Create abort controller
  ctx.abortController?.abort();
  ctx.abortController = new AbortController();

  // Call STT
  const sttStartTime = Date.now();
  const result = await transcribeWav(wav, {
    provider: runtime.stt.provider,
    apiKey,
    signal: ctx.abortController.signal,
    model: runtime.stt.model,
    language: ctx.clientLanguage || runtime.stt.language,
    prompt: sttPrompt,
    timeoutMs: runtime.stt.timeoutMs,
  });

  const sttDuration = Date.now() - sttStartTime;
  const ttfb = result.timings.headersAt - result.timings.startAt;

  // Track timing
  ctx.timing.sttDurationMs = sttDuration;
  ctx.timing.sttTtfbMs = ttfb;

  // Log STT completion
  logSessionSTT({
    outcome: "success",
    provider: runtime.stt.provider,
    model: runtime.stt.model,
    duration_ms: sttDuration,
    ttfb_ms: ttfb,
    text_length: result.text.length,
    trace_id: session.traceId ?? "unknown",
  });

  return {
    text: result.text,
    timings: result.timings,
    provider: runtime.stt.provider,
    model: runtime.stt.model,
  };
}

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
