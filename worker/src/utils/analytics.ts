/**
 * Analytics Engine Helper
 *
 * Tracks session lifecycle metrics for long-term analysis and dashboards.
 *
 * Key metrics tracked:
 * - Full session lifecycle (from connection to completion)
 * - Timing breakdown (auth, OCR, STT, LLM, overhead)
 * - Provider performance comparison
 * - Error tracking by stage
 */

/**
 * Session lifecycle event for Analytics Engine
 * Captures complete session metrics in a single data point
 */
export type SessionLifecycleEvent = {
  // Identity
  trace_id: string;
  user_id?: string;

  // Outcome
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
  error_stage?: "auth" | "ocr" | "stt" | "llm" | "send";
  error_message?: string;

  // Providers
  stt_provider?: string;
  llm_provider?: string;

  // Timing metrics (all in milliseconds)
  worker_lifetime_ms: number;
  auth_ms: number;
  ocr_ms: number;
  first_frame_latency_ms: number | null;
  audio_streaming_ms: number | null;
  assemble_ms: number;
  stt_ms: number;
  router_overhead_ms: number;
  llm_ms: number;
  total_processing_ms: number;
  overhead_ms: number;

  // Traffic metrics
  audio_frames: number;
  audio_bytes_kb: number;
  seq_gaps: number;

  // Flags
  cold_start: boolean;
};

/**
 * Legacy analytics event (kept for backwards compatibility)
 * Will be deprecated once session.lifecycle is fully rolled out
 */
export type AnalyticsEvent = {
  // Event metadata
  event: string; // Event type (e.g., 'jwt.verify', 'db.quota_increment')
  traceId?: string; // Session trace ID for correlation
  userId?: string; // User ID (if authenticated)

  // Timing metrics (all in milliseconds)
  durationMs?: number; // How long the operation took
  ttfbMs?: number; // Time to first byte (for network calls)

  // Status
  success: boolean; // Did the operation succeed?
  error?: string; // Error message (if failed)

  // Context
  provider?: string; // Provider name (e.g., 'groq', 'baseten')
  model?: string; // Model name (for LLM/STT)
  cached?: boolean; // Was this result cached?
  coldStart?: boolean; // Was this a cold start?

  // Additional metadata (specific to event type)
  [key: string]: any;
};

/**
 * Track session lifecycle in Analytics Engine
 * This is the primary analytics event - captures full session metrics
 */
export function trackSessionLifecycle(
  analytics: AnalyticsEngineDataset | undefined,
  event: SessionLifecycleEvent,
): void {
  // Skip if Analytics Engine is not configured (e.g., in dev environments)
  if (!analytics) {
    return;
  }

  try {
    // Write to Analytics Engine
    // NOTE: Only ONE index is allowed per data point (used for sampling)
    // See: https://developers.cloudflare.com/analytics/analytics-engine/limits/
    analytics.writeDataPoint({
      // Index: sampling key (only one allowed!)
      indexes: [
        event.user_id || "anonymous", // index1: user ID (for sampling)
      ],
      // Blob data (queryable strings) - 7 available
      blobs: [
        "session.lifecycle", // blob1: event type (constant)
        event.trace_id, // blob2: trace ID (for correlation)
        event.outcome, // blob3: outcome (success/error_*)
        event.mode, // blob4: mode (dictation/edit)
        event.stt_provider || "", // blob5: STT provider
        event.llm_provider || "", // blob6: LLM provider
        event.error_stage || "", // blob7: error stage (if failed)
      ],
      // Numeric metrics (aggregatable) - 20 available, using 15
      doubles: [
        event.worker_lifetime_ms, // double1: full worker duration
        event.auth_ms, // double2: JWT verification time
        event.ocr_ms, // double3: OCR processing time
        event.first_frame_latency_ms ?? 0, // double4: auth + TLS + first upload
        event.audio_streaming_ms ?? 0, // double5: user speaking duration
        event.assemble_ms, // double6: audio concatenation time
        event.stt_ms, // double7: STT API call time
        event.router_overhead_ms, // double8: STT → LLM routing time
        event.llm_ms, // double9: LLM API call time
        event.total_processing_ms, // double10: stt_ms + llm_ms
        event.overhead_ms, // double11: everything else
        event.audio_frames, // double12: frame count
        event.audio_bytes_kb, // double13: audio size
        event.seq_gaps, // double14: dropped frames
        event.cold_start ? 1 : 0, // double15: cold start flag (0/1)
      ],
    });
  } catch (error) {
    // Silent fail - analytics should never break the worker
    console.warn("[Analytics] Failed to write session lifecycle:", error);
  }
}

