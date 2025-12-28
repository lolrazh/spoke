import { concat, wrapWav } from "../audio/codec";
import { transcribeWav } from "../services/stt";
import { buildSTTPrompt } from "../services/stt/prompt";
import { logSessionAudio, logSessionSTT } from "../utils/sessionLogger";
import type { ConnectionContext, TranscribeResult } from "./types";

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
