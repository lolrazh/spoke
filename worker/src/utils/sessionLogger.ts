/**
 * Structured Session Logging for Cloudflare Workers Observability
 *
 * Follows Cloudflare best practices:
 * - JSON structured logs with message field for dashboard titles
 * - Consistent snake_case naming
 * - Level field for filtering (info, warn, error)
 * - Outcome field instead of separate error events
 * - High cardinality fields (trace_id, user_id) for querying
 */

type LogLevel = "info" | "warn" | "error" | "debug";

type SessionAuthLog = {
  outcome:
    | "success"
    | "quota_exceeded"
    | "invalid"
    | "timeout"
    | "missing_token";
  duration_ms: number;
  cold_start: boolean;
  trace_id: string;
  user_id?: string;
};

type SessionOCRLog = {
  outcome: "success" | "error" | "rejected" | "skipped" | "no_api_key";
  duration_ms?: number;
  word_count?: number;
  trace_id: string;
  error_message?: string;
};

type SessionAudioLog = {
  frames: number;
  bytes_kb: number;
  streaming_duration_ms: number | null;
  seq_gaps: number;
  trace_id: string;
};

type SessionSTTLog = {
  outcome: "success" | "error" | "timeout";
  provider: string;
  model: string;
  duration_ms: number;
  ttfb_ms?: number;
  text_length: number;
  trace_id: string;
  error_message?: string;
};

type SessionLLMLog = {
  outcome: "success" | "error" | "timeout" | "skipped";
  provider: string;
  model: string;
  duration_ms: number;
  ttfb_ms?: number;
  router_overhead_ms: number;
  text_length: number;
  trace_id: string;
  error_message?: string;
};

type SessionCompleteLog = {
  outcome:
    | "success"
    | "error_auth"
    | "error_stt"
    | "error_llm"
    | "error_send"
    | "client_disconnect"
    | "timeout"
    | "crash";
  mode: "dictation" | "edit";
  worker_lifetime_ms: number;
  auth_ms: number;
  ocr_ms: number;
  first_frame_latency_ms: number | null;
  audio_streaming_ms: number | null;
  assemble_ms: number;
  stt_ms: number;
  llm_ms: number;
  total_processing_ms: number;
  overhead_ms: number;
  trace_id: string;
  user_id?: string;
  stt_provider?: string;
  llm_provider?: string;
  error_stage?: "auth" | "ocr" | "stt" | "llm" | "send";
  error_message?: string;
};

type SessionErrorLog = {
  stage: "auth" | "ocr" | "stt" | "llm" | "send" | "unknown";
  error_type: string;
  error_message: string;
  provider?: string;
  trace_id: string;
};

/**
 * Log session auth completion
 */
export function logSessionAuth(data: SessionAuthLog): void {
  const { outcome, duration_ms, cold_start, trace_id, user_id } = data;

  const level: LogLevel = outcome === "success" ? "info" : "error";
  const outcomeText =
    outcome === "success"
      ? "verified"
      : outcome === "quota_exceeded"
        ? "quota exceeded"
        : outcome === "invalid"
          ? "invalid token"
          : outcome === "timeout"
            ? "timeout"
            : "missing token";

  const coldStartSuffix = cold_start ? " [cold start]" : "";

  console.log(
    JSON.stringify({
      level,
      message: `Auth: JWT ${outcomeText} in ${duration_ms}ms${coldStartSuffix}`,
      event: "session.auth",
      outcome,
      duration_ms,
      cold_start,
      trace_id,
      user_id,
    }),
  );
}

/**
 * Log OCR extraction completion
 */
export function logSessionOCR(data: SessionOCRLog): void {
  const { outcome, duration_ms, word_count, trace_id, error_message } = data;

  const level: LogLevel =
    outcome === "success" ? "info" : outcome === "error" ? "error" : "warn";

  let message: string;
  if (
    outcome === "success" &&
    word_count !== undefined &&
    duration_ms !== undefined
  ) {
    message = `OCR: Extracted ${word_count} words in ${duration_ms}ms`;
  } else if (outcome === "skipped") {
    message = "OCR: Skipped (no image provided)";
  } else if (outcome === "rejected") {
    message = "OCR: Rejected (image too large or empty)";
  } else if (outcome === "no_api_key") {
    message = "OCR: Skipped (no API key configured)";
  } else {
    message = `OCR: Failed - ${error_message || "unknown error"}`;
  }

  console.log(
    JSON.stringify({
      level,
      message,
      event: "session.ocr",
      outcome,
      duration_ms: duration_ms ?? null,
      word_count: word_count ?? null,
      trace_id,
      error_message: error_message ?? null,
    }),
  );
}

/**
 * Log audio streaming completion
 */
export function logSessionAudio(data: SessionAudioLog): void {
  const { frames, bytes_kb, streaming_duration_ms, seq_gaps, trace_id } = data;

  const durationText = streaming_duration_ms
    ? ` over ${(streaming_duration_ms / 1000).toFixed(1)}s`
    : "";
  const gapText = seq_gaps > 0 ? ` [${seq_gaps} gaps]` : "";

  console.log(
    JSON.stringify({
      level: "info",
      message: `Audio: ${frames} frames, ${bytes_kb}KB${durationText}${gapText}`,
      event: "session.audio",
      frames,
      bytes_kb,
      streaming_duration_ms,
      seq_gaps,
      trace_id,
    }),
  );
}

/**
 * Log STT transcription completion
 */
export function logSessionSTT(data: SessionSTTLog): void {
  const {
    outcome,
    provider,
    model,
    duration_ms,
    ttfb_ms,
    text_length,
    trace_id,
    error_message,
  } = data;

  const level: LogLevel = outcome === "success" ? "info" : "error";

  let message: string;
  if (outcome === "success") {
    message = `STT: ${provider} transcribed in ${duration_ms}ms → ${text_length} chars`;
  } else {
    message = `STT: ${provider} ${outcome} - ${error_message || "unknown error"}`;
  }

  console.log(
    JSON.stringify({
      level,
      message,
      event: "session.stt",
      outcome,
      provider,
      model,
      duration_ms,
      ttfb_ms: ttfb_ms ?? null,
      text_length,
      trace_id,
      error_message: error_message ?? null,
    }),
  );
}

/**
 * Log LLM processing completion
 */
export function logSessionLLM(data: SessionLLMLog): void {
  const {
    outcome,
    provider,
    model,
    duration_ms,
    ttfb_ms,
    router_overhead_ms,
    text_length,
    trace_id,
    error_message,
  } = data;

  const level: LogLevel =
    outcome === "success" ? "info" : outcome === "skipped" ? "debug" : "error";

  let message: string;
  if (outcome === "success") {
    message = `LLM: ${provider} processed in ${duration_ms}ms → ${text_length} chars`;
  } else if (outcome === "skipped") {
    message = "LLM: Skipped (dictation mode)";
  } else {
    message = `LLM: ${provider} ${outcome} - ${error_message || "unknown error"}`;
  }

  console.log(
    JSON.stringify({
      level,
      message,
      event: "session.llm",
      outcome,
      provider,
      model,
      duration_ms,
      ttfb_ms: ttfb_ms ?? null,
      router_overhead_ms,
      text_length,
      trace_id,
      error_message: error_message ?? null,
    }),
  );
}

/**
 * Log session completion (success or failure)
 * CRITICAL: Call this on ALL exit paths (success, error, timeout, disconnect)
 */
export function logSessionComplete(data: SessionCompleteLog): void {
  const {
    outcome,
    mode,
    worker_lifetime_ms,
    auth_ms,
    ocr_ms,
    first_frame_latency_ms,
    audio_streaming_ms,
    assemble_ms,
    stt_ms,
    llm_ms,
    total_processing_ms,
    overhead_ms,
    trace_id,
    user_id,
    stt_provider,
    llm_provider,
    error_stage,
    error_message,
  } = data;

  const level: LogLevel = outcome === "success" ? "info" : "error";

  let message: string;
  if (outcome === "success") {
    const llmText = llm_ms > 0 ? ` + ${llm_ms}ms LLM` : "";
    message = `Session: Completed in ${(worker_lifetime_ms / 1000).toFixed(1)}s (${stt_ms}ms STT${llmText})`;
  } else {
    const stageText = error_stage ? ` at ${error_stage}` : "";
    message = `Session: Failed${stageText} - ${error_message || outcome}`;
  }

  console.log(
    JSON.stringify({
      level,
      message,
      event: "session.complete",
      outcome,
      mode,
      worker_lifetime_ms,
      auth_ms,
      ocr_ms,
      first_frame_latency_ms,
      audio_streaming_ms,
      assemble_ms,
      stt_ms,
      llm_ms,
      total_processing_ms,
      overhead_ms,
      trace_id,
      user_id: user_id ?? null,
      stt_provider: stt_provider ?? null,
      llm_provider: llm_provider ?? null,
      error_stage: error_stage ?? null,
      error_message: error_message ?? null,
    }),
  );
}

/**
 * Log session error (for detailed error tracking)
 */
export function logSessionError(data: SessionErrorLog): void {
  const { stage, error_type, error_message, provider, trace_id } = data;

  const providerText = provider ? ` (${provider})` : "";

  console.log(
    JSON.stringify({
      level: "error",
      message: `Error at ${stage}${providerText}: ${error_message}`,
      event: "session.error",
      stage,
      error_type,
      error_message,
      provider: provider ?? null,
      trace_id,
    }),
  );
}
