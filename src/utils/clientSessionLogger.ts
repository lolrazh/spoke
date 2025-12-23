/**
 * Client-Side Wide Event Logging
 *
 * Philosophy: ONE canonical log line per transcription session.
 * Inspired by https://loggingsucks.com/
 *
 * Instead of scattered console.log() calls, we build up a rich event
 * throughout the session lifecycle and emit it ONCE at the end.
 *
 * Benefits:
 * - High cardinality: trace_id for correlation with server logs
 * - High dimensionality: 30+ fields capturing full session context
 * - Single source of truth: no grep-ing multiple log lines
 * - Automatic Sentry capture on failures
 */

export type ClientSessionOutcome =
  | "success"
  | "cancelled"
  | "error_timeout"
  | "error_ws_closed"
  | "error_ws_failed"
  | "error_network"
  | "error_audio"
  | "error_auth"
  | "error_unknown";

export interface ClientSessionEvent {
  // Identity
  timestamp: string;
  trace_id: string;
  session_id: string;

  // Outcome
  outcome: ClientSessionOutcome;
  error_message?: string;
  error_type?: string;

  // Session metadata
  mode: "dictation" | "edit";
  vad_enabled: boolean;

  // WebSocket state
  ws_url: string;
  ws_ready: boolean;
  ws_authenticated: boolean;
  ws_final_state?: number; // WebSocket.readyState at end

  // Timing breakdown (all in ms)
  ptt_down_ms?: number;
  ws_open_ms?: number;
  first_frame_out_ms?: number;
  last_frame_out_ms?: number;
  stop_invoked_ms?: number;
  end_sent_ms?: number;
  stt_start_ms?: number;
  final_recv_ms?: number;
  paste_start_ms?: number;
  paste_done_ms?: number;

  // Derived metrics (computed from above)
  dictation_duration_ms?: number; // stop - ptt_down
  e2e_latency_ms?: number; // paste_done - stop_invoked
  ws_open_latency_ms?: number; // ws_open - ptt_down
  processing_latency_ms?: number; // final_recv - end_sent

  // Audio metrics
  frames_produced: number;
  frames_forwarded?: number; // Only if VAD enabled
  bytes_produced: number;

  // Result
  text_length?: number;
  word_count?: number;

  // Server metrics (if received)
  server?: {
    worker_lifetime_ms?: number;
    stt_ms?: number;
    llm_ms?: number;
    audio_streaming_ms?: number;
  };
}

/**
 * Emit the canonical client session event.
 * Logs to console AND sends to Sentry if outcome !== "success".
 */
export function logClientSession(event: ClientSessionEvent): void {
  // Always log to console (structured JSON)
  const level =
    event.outcome === "success" || event.outcome === "cancelled" ? "info" : "error";

  if (level === "error") {
    console.error("[Session]", event);
  } else {
    console.info("[Session]", event);
  }

  // Send to Sentry on failures
  if (event.outcome !== "success" && event.outcome !== "cancelled") {
    void (async () => {
      try {
        const Sentry = await import("@sentry/electron/renderer");

        // Create a synthetic error with context
        const error = new Error(`Transcription failed: ${event.outcome}`);
        error.name = "TranscriptionError";

        Sentry.captureException(error, {
          level: "error",
          tags: {
            component: "transcription",
            outcome: event.outcome,
            mode: event.mode,
          },
          contexts: {
            session: {
              trace_id: event.trace_id,
              session_id: event.session_id,
              outcome: event.outcome,
              error_type: event.error_type,
            },
            timing: {
              dictation_duration_ms: event.dictation_duration_ms,
              e2e_latency_ms: event.e2e_latency_ms,
              processing_latency_ms: event.processing_latency_ms,
            },
            audio: {
              frames_produced: event.frames_produced,
              frames_forwarded: event.frames_forwarded,
              bytes_produced: event.bytes_produced,
            },
            websocket: {
              ws_ready: event.ws_ready,
              ws_authenticated: event.ws_authenticated,
              ws_final_state: event.ws_final_state,
            },
          },
          extra: {
            full_event: event, // Send the entire canonical event for deep debugging
          },
        });
      } catch (err) {
        console.warn("[Session] Failed to send to Sentry:", err);
      }
    })();
  }
}

/**
 * Helper to build the event throughout the session.
 *
 * Usage:
 *
 * const builder = new ClientSessionEventBuilder(sessionId, "dictation");
 * builder.setTiming({ pttDownMs: performance.now() });
 * // ... session progresses ...
 * builder.setOutcome("success", { text: finalText, wordCount });
 * builder.emit(); // Logs the canonical event
 */
export class ClientSessionEventBuilder {
  private event: Partial<ClientSessionEvent>;

  constructor(sessionId: string, mode: "dictation" | "edit") {
    this.event = {
      timestamp: new Date().toISOString(),
      trace_id: sessionId, // Can be overwritten if server provides a trace ID
      session_id: sessionId,
      mode,
      frames_produced: 0,
      bytes_produced: 0,
      vad_enabled: false,
      ws_ready: false,
      ws_authenticated: false,
      ws_url: "",
    };
  }

  setTraceId(traceId: string): this {
    this.event.trace_id = traceId;
    return this;
  }

  setWsUrl(url: string): this {
    this.event.ws_url = url;
    return this;
  }

  setWsState(ready: boolean, authenticated: boolean, finalState?: number): this {
    this.event.ws_ready = ready;
    this.event.ws_authenticated = authenticated;
    if (finalState !== undefined) {
      this.event.ws_final_state = finalState;
    }
    return this;
  }

  setVadEnabled(enabled: boolean): this {
    this.event.vad_enabled = enabled;
    return this;
  }

  setTiming(metrics: {
    pttDownMs?: number;
    wsOpenMs?: number;
    firstFrameOutMs?: number;
    lastFrameOutMs?: number;
    stopInvokedMs?: number;
    endSentMs?: number;
    sttStartMs?: number;
    finalRecvMs?: number;
    pasteStartMs?: number;
    pasteDoneMs?: number;
  }): this {
    if (metrics.pttDownMs) this.event.ptt_down_ms = metrics.pttDownMs;
    if (metrics.wsOpenMs) this.event.ws_open_ms = metrics.wsOpenMs;
    if (metrics.firstFrameOutMs) this.event.first_frame_out_ms = metrics.firstFrameOutMs;
    if (metrics.lastFrameOutMs) this.event.last_frame_out_ms = metrics.lastFrameOutMs;
    if (metrics.stopInvokedMs) this.event.stop_invoked_ms = metrics.stopInvokedMs;
    if (metrics.endSentMs) this.event.end_sent_ms = metrics.endSentMs;
    if (metrics.sttStartMs) this.event.stt_start_ms = metrics.sttStartMs;
    if (metrics.finalRecvMs) this.event.final_recv_ms = metrics.finalRecvMs;
    if (metrics.pasteStartMs) this.event.paste_start_ms = metrics.pasteStartMs;
    if (metrics.pasteDoneMs) this.event.paste_done_ms = metrics.pasteDoneMs;
    return this;
  }

  setAudioMetrics(frames: number, bytes: number, framesForwarded?: number): this {
    this.event.frames_produced = frames;
    this.event.bytes_produced = bytes;
    if (framesForwarded !== undefined) {
      this.event.frames_forwarded = framesForwarded;
    }
    return this;
  }

  setServerMetrics(metrics: {
    worker_lifetime_ms?: number;
    stt_ms?: number;
    llm_ms?: number;
    audio_streaming_ms?: number;
  }): this {
    this.event.server = metrics;
    return this;
  }

  setOutcome(
    outcome: ClientSessionOutcome,
    result?: { text?: string; wordCount?: number },
    error?: { message?: string; type?: string },
  ): this {
    this.event.outcome = outcome;

    if (result?.text) {
      this.event.text_length = result.text.length;
      this.event.word_count = result.wordCount;
    }

    if (error) {
      this.event.error_message = error.message;
      this.event.error_type = error.type;
    }

    // Compute derived metrics
    const e = this.event;
    if (e.stop_invoked_ms && e.ptt_down_ms) {
      e.dictation_duration_ms = Math.round(e.stop_invoked_ms - e.ptt_down_ms);
    }
    if (e.paste_done_ms && e.stop_invoked_ms) {
      e.e2e_latency_ms = Math.round(e.paste_done_ms - e.stop_invoked_ms);
    }
    if (e.ws_open_ms && e.ptt_down_ms) {
      e.ws_open_latency_ms = Math.round(e.ws_open_ms - e.ptt_down_ms);
    }
    if (e.final_recv_ms && e.end_sent_ms) {
      e.processing_latency_ms = Math.round(e.final_recv_ms - e.end_sent_ms);
    }

    return this;
  }

  /**
   * Emit the canonical log line.
   */
  emit(): void {
    if (!this.event.outcome) {
      console.warn(
        "[Session] emit() called without outcome - setting to error_unknown",
      );
      this.event.outcome = "error_unknown";
    }

    logClientSession(this.event as ClientSessionEvent);
  }
}
