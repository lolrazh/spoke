import type { Context } from "hono";

import { getClientIP } from "../utils/ip";
import { trackConnection, releaseConnection } from "../utils/connLimit";
import { createLogger } from "../utils/logger";
import { safeClose, safeJson } from "../utils/ws";
import { createEmptySession, logSession } from "../ws/session";
import { getRuntimeConfig } from "../config/runtime";
import { safely } from "../utils/safely";
import { parseClientMessage } from "../types/messages";

// Pipeline modules
import type { ConnectionContext } from "../pipeline/types";
import {
  setupAuthTimeout,
  clearAuthTimeout,
  handleAuth,
  sendAuthError,
  sendAuthSuccess,
} from "../pipeline/auth";
import { handleAudioFrame } from "../pipeline/audio";
import { transcribe } from "../pipeline/transcribe";
import { routeTranscript } from "../pipeline/router";
import { extractOCR } from "../pipeline/ocr";

// Logging
import { logSessionComplete, logSessionError } from "../utils/sessionLogger";
import { scheduleQuotaIncrement, scheduleAnalytics } from "../background/tasks";

// Types
export type Bindings = {
  // Supabase (required for auth)
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // STT providers
  GROQ_API_KEY?: string;
  SIMPLISMART_API_KEY?: string;
  // LLM providers
  BASETEN_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  // LLM config
  ENABLE_LLM?: string;
  LLM_STREAM?: string;
  LLM_MODEL?: string;
  // Auth bypass
  SKIP_AUTH?: string;
  // Analytics Engine
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;
};

/**
 * Message handler dispatch table
 */
const messageHandlers: Record<
  string,
  (ctx: ConnectionContext, parsed: any) => Promise<void> | void
> = {
  auth: handleAuthMessage,
  start: handleStartMessage,
  end: handleEndMessage,
  context_ocr: handleOCRMessage,
  cancel: handleCancelMessage,
};

/**
 * WebSocket route handler - entry point for all connections
 */
export function wsRoute(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.text("Expected a websocket connection", 426);
  }

  const logger = createLogger();
  const clientIP = getClientIP(c.req.raw);
  const cfColo = (c.req.raw as any).cf?.colo ?? "unknown";

  logger.info(`[WS] Connection from ${clientIP}, CF colo: ${cfColo}`);

  if (!trackConnection(clientIP)) {
    return c.text(
      "Too many connections from your IP. Please try again later.",
      429,
    );
  }

  const [client, server] = Object.values(new WebSocketPair());

  // Initialize connection context
  const ctx: ConnectionContext = {
    server,
    socketClosed: false,
    env: c.env,
    clientIP,
    cfColo,
    runtime: getRuntimeConfig(c.env),
    session: createEmptySession(),
    traceId: crypto.randomUUID(),
    authenticated: parseBoolish(c.env.SKIP_AUTH) === true,
    userId: null,
    email: null,
    subscriptionActive: false,
    abortController: null,
    authTimeoutHandle: null,
    sessionActive: false,
    finalSent: false,
    completionLogged: false,
    timing: { wsAcceptAt: Date.now() },
    executionCtx: c.executionCtx,
  };

  ctx.session.wsAcceptAt = ctx.timing.wsAcceptAt;
  ctx.session.traceId = ctx.traceId;

  server.accept();

  // Set up auth timeout (unless SKIP_AUTH)
  if (!ctx.authenticated) {
    setupAuthTimeout(ctx);
  }

  // Message handler
  server.addEventListener("message", async (evt: MessageEvent) => {
    try {
      if (typeof evt.data === "string") {
        const msg = safeJson(evt.data);
        const parsed = parseClientMessage(msg);
        if (!parsed) return;

        const handler = messageHandlers[parsed.type];
        if (handler) {
          await handler(ctx, parsed);
        }
      } else if (evt.data instanceof ArrayBuffer) {
        handleAudioFrame(ctx, evt.data);
      }
    } catch (e: any) {
      handleError(ctx, e);
    }
  });

  // Close handler
  server.addEventListener("close", (evt) => {
    handleClose(ctx, evt);
    releaseConnection(clientIP);
  });

  // Error handler
  server.addEventListener("error", (evt) => {
    handleSocketError(ctx, evt);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// Message handlers

async function handleAuthMessage(
  ctx: ConnectionContext,
  parsed: any,
): Promise<void> {
  clearAuthTimeout(ctx);

  if (ctx.authenticated) {
    const logger = createLogger();
    logger.warn("[WS] duplicate auth ignored");
    return;
  }

  // Adopt client traceId
  if (parsed.traceId && parsed.traceId !== ctx.traceId) {
    ctx.traceId = parsed.traceId;
    ctx.session.traceId = parsed.traceId;
  }

  if (!parsed.token) {
    sendAuthError(ctx, "Token is required", 4001);
    return;
  }

  const result = await handleAuth(ctx, parsed.token);

  if (!result.success) {
    sendAuthError(ctx, result.error!, result.code!);
    return;
  }

  ctx.authenticated = true;
  ctx.userId = result.userId!;
  ctx.email = result.email!;
  ctx.subscriptionActive = result.subscriptionActive!;

  sendAuthSuccess(ctx);
}

function handleStartMessage(ctx: ConnectionContext, parsed: any): void {
  if (!ctx.authenticated) {
    const logger = createLogger();
    logger.warn("[WS] start message before auth");
    return;
  }

  ctx.sessionActive = true;
  ctx.session.mode = parsed.mode ?? "dictation";
  ctx.session.selection = parsed.selection;

  if (parsed.identity) {
    ctx.session.identity = {
      name: parsed.identity?.name ?? null,
      email: parsed.identity?.email ?? null,
    };
  }

  if (parsed.language) {
    ctx.clientLanguage = parsed.language;
  }
}

async function handleEndMessage(
  ctx: ConnectionContext,
  parsed: any,
): Promise<void> {
  if (!ctx.sessionActive) {
    const logger = createLogger();
    logger.warn("[WS] end message before start");
    return;
  }

  // Send processing status
  safely(() =>
    ctx.server.send(
      JSON.stringify({
        type: "status",
        state: "processing",
        traceId: ctx.session.traceId,
        serverTs: Date.now(),
      }),
    ),
  );

  // Transcribe
  const sttResult = await transcribe(ctx);
  if (!sttResult) {
    // Empty session
    const text = "";
    ctx.server.send(JSON.stringify({ type: "final", text }));
    safeClose(ctx.server, 1000, "done");
    ctx.sessionActive = false;
    return;
  }

  // Route decision
  const route = routeTranscript(ctx, sttResult.text);

  let finalText = sttResult.text;

  // Enhance if needed (LAZY LOAD)
  if (route.requiresLLM) {
    const { enhance } = await import("../pipeline/enhance");
    const enhanced = await enhance(
      ctx,
      sttResult.text,
      route,
      ctx.runtime.stt.prompt,
    );
    finalText = enhanced.text;
  }

  // Send final
  ctx.server.send(JSON.stringify({ type: "final", text: finalText }));
  ctx.finalSent = true;

  // Background tasks
  scheduleBackgroundTasks(ctx, sttResult, finalText, ctx.executionCtx);

  safeClose(ctx.server, 1000, "done");
  ctx.sessionActive = false;
}

function handleOCRMessage(ctx: ConnectionContext, parsed: any): void {
  if (!ctx.sessionActive) {
    const logger = createLogger();
    logger.warn("[WS] ocr message before start");
    return;
  }

  const imageBase64 = parsed.imageBase64;
  if (!imageBase64) {
    return;
  }

  ctx.session.ocrPending = true;

  extractOCR(ctx, imageBase64);
}

function handleCancelMessage(ctx: ConnectionContext, parsed: any): void {
  if (!ctx.sessionActive) {
    const logger = createLogger();
    logger.warn("[WS] cancel message before start");
    return;
  }

  ctx.session.canceled = true;
  ctx.abortController?.abort();

  ctx.server.send(
    JSON.stringify({
      type: "canceled",
      traceId: ctx.session.traceId,
      serverTs: Date.now(),
    }),
  );

  safeClose(ctx.server, 1000, "canceled");
  ctx.sessionActive = false;
}

// Lifecycle handlers

function handleClose(ctx: ConnectionContext, evt: CloseEvent): void {
  ctx.socketClosed = true;
  ctx.abortController?.abort();
  ctx.authTimeoutHandle && clearTimeout(ctx.authTimeoutHandle);

  const logger = createLogger();
  logger.info(
    `[WS] Connection closed: code=${evt.code}, reason="${evt.reason || "none"}"`,
  );

  logSession((msg, ctxData) => logger.info(msg, ctxData), "close", ctx.session);
}

function handleSocketError(ctx: ConnectionContext, evt: Event): void {
  ctx.socketClosed = true;

  const logger = createLogger();
  logger.error(`[WS] WebSocket error`);

  logSessionError({
    stage: "unknown",
    error_type: "websocket_error",
    error_message: "WebSocket error occurred",
    trace_id: ctx.session.traceId ?? "unknown",
  });
}

function handleError(ctx: ConnectionContext, e: Error): void {
  const logger = createLogger();
  logger.error(`[WS] Handler error: ${e.message}`);

  if (!ctx.socketClosed) {
    safely(() =>
      ctx.server.send(
        JSON.stringify({
          type: "error",
          error: e.message,
        }),
      ),
    );
  }

  logSessionError({
    stage: "unknown",
    error_type: "handler_error",
    error_message: e.message,
    trace_id: ctx.session.traceId ?? "unknown",
  });
}

function scheduleBackgroundTasks(
  ctx: ConnectionContext,
  sttResult: any,
  finalText: string,
  executionCtx?: ExecutionContext,
): void {
  // Calculate word count for quota
  const wordCount = finalText
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  // Schedule quota increment (for free tier users)
  scheduleQuotaIncrement(ctx, wordCount, executionCtx);

  // Schedule analytics logging
  scheduleAnalytics(
    ctx,
    {
      stt_provider: sttResult.provider,
      stt_model: sttResult.model,
      final_text: finalText,
      word_count: wordCount,
    },
    executionCtx,
  );

  // Log session completion
  const totalProcessingMs = Date.now() - ctx.timing.wsAcceptAt;
  logSessionComplete({
    outcome: "success",
    mode: ctx.session.mode as "dictation" | "edit",
    worker_lifetime_ms: totalProcessingMs,
    auth_ms: ctx.timing.authDurationMs ?? 0,
    ocr_ms: ctx.timing.ocrDurationMs ?? 0,
    first_frame_latency_ms:
      ctx.timing.firstFrameAt && ctx.timing.wsAcceptAt
        ? ctx.timing.firstFrameAt - ctx.timing.wsAcceptAt
        : null,
    audio_streaming_ms:
      ctx.timing.firstFrameAt && ctx.timing.lastFrameAt
        ? ctx.timing.lastFrameAt - ctx.timing.firstFrameAt
        : null,
    assemble_ms: ctx.timing.assembleMs ?? 0,
    stt_ms: ctx.timing.sttDurationMs ?? 0,
    llm_ms: ctx.timing.llmDurationMs ?? 0,
    total_processing_ms:
      (ctx.timing.sttDurationMs ?? 0) + (ctx.timing.llmDurationMs ?? 0),
    overhead_ms:
      totalProcessingMs -
      (ctx.timing.sttDurationMs ?? 0) -
      (ctx.timing.llmDurationMs ?? 0),
    trace_id: ctx.traceId,
    user_id: ctx.userId ?? undefined,
    stt_provider: sttResult.provider,
  });
}

// Utility functions

function parseBoolish(value?: string): boolean | undefined {
  if (!value) return undefined;
  const s = value.toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return undefined;
}
