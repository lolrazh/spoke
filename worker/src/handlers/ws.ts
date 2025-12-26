import type { Context } from 'hono';

import { parseClientMessage } from '../types/messages';
import { getClientIP } from '../utils/ip';
import { trackConnection, releaseConnection } from '../utils/connLimit';
import { createLogger } from '../utils/logger';
import { safeClose, safeJson } from '../utils/ws';
import { concat, parseFrameHeader, wrapWav } from '../audio/codec';
import { createEmptySession, logSession } from '../ws/session';
import { transcribeWav } from '../services/stt';
import { chatCompleteByProvider } from '../services/llm';
import { prepareEditRequest, buildEditSystemPrompt } from '../services/llm/editPrompt';
import { buildSTTPrompt } from '../services/stt/prompt';
import { getRuntimeConfig } from '../config/runtime';
import { safely } from '../utils/safely';
import { detectTriggers } from '../services/llm/triggers';
import { composeDynamicPrompt, estimatePromptTokens } from '../services/llm/prompts';
import { selectSmartRoute, selectEditRoute } from '../services/llm/smartRouting';
import { trackSessionLifecycle } from '../utils/analytics';
import {
  logSessionAuth,
  logSessionOCR,
  logSessionAudio,
  logSessionSTT,
  logSessionLLM,
  logSessionComplete,
  logSessionError,
} from '../utils/sessionLogger';
import {
  verifySupabaseJwt,
  WS_CLOSE_CODES,
  AUTH_TIMEOUT_MS,
} from '../auth';
import {
  GROQ_STT_ENDPOINT,
  FIREWORKS_STT_TURBO_ENDPOINT,
  DEEPGRAM_STT_ENDPOINT,
  SIMPLISMART_STT_ENDPOINT,
  GROQ_LLM_ENDPOINT,
  OPENAI_LLM_ENDPOINT,
  BASETEN_LLM_ENDPOINT,
  OPENROUTER_LLM_ENDPOINT,
  CEREBRAS_LLM_ENDPOINT,
} from '../config';

type Bindings = {
  // Supabase (required for auth)
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // STT providers
  GROQ_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  SIMPLISMART_API_KEY?: string;
  // LLM providers
  OPENAI_API_KEY?: string;
  BASETEN_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  // LLM config
  ENABLE_LLM?: string; // '1' | 'true' to enable
  LLM_STREAM?: string; // '1' | 'true' to stream deltas
  LLM_MODEL?: string; // default from src/config.ts
  // OpenRouter config
  OPENROUTER_HTTP_REFERER?: string;
  OPENROUTER_APP_TITLE?: string;
  OPENROUTER_PROVIDER_SORT?: string;
  OPENROUTER_PROVIDER_ORDER?: string;
  OPENROUTER_PROVIDER_ONLY?: string;
  OPENROUTER_PROVIDER_IGNORE?: string;
  OPENROUTER_ALLOW_FALLBACKS?: string;
  OPENROUTER_REQUIRE_PARAMETERS?: string;
  OPENROUTER_DATA_COLLECTION?: string;
  OPENROUTER_ZDR?: string;
  OPENROUTER_PROVIDER_QUANTIZATIONS?: string;
  OPENROUTER_PROVIDER_MAX_PRICE_PROMPT?: string;
  OPENROUTER_PROVIDER_MAX_PRICE_COMPLETION?: string;
  OPENROUTER_PROVIDER_MAX_PRICE_REQUEST?: string;
  OPENROUTER_PROVIDER_MAX_PRICE_IMAGE?: string;
  // Auth bypass (for dev/testing)
  SKIP_AUTH?: string; // '1' | 'true' to skip auth check
  // Analytics Engine (optional - graceful degradation if not configured)
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;
};

function parseBoolish(value?: string): boolean | undefined {
  if (!value) return undefined;
  const s = value.toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return undefined;
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildOpenRouterProviderConfig(env: Bindings): Record<string, any> {
  const config: Record<string, any> = {};

  const sort = (env.OPENROUTER_PROVIDER_SORT || 'latency').toLowerCase();
  if (sort === 'latency' || sort === 'price' || sort === 'throughput') {
    config.sort = sort;
  } else {
    config.sort = 'latency';
  }

  const order = parseList(env.OPENROUTER_PROVIDER_ORDER);
  if (order) config.order = order;

  const only = parseList(env.OPENROUTER_PROVIDER_ONLY);
  if (only) config.only = only;

  const ignore = parseList(env.OPENROUTER_PROVIDER_IGNORE);
  if (ignore) config.ignore = ignore;

  const quantizations = parseList(env.OPENROUTER_PROVIDER_QUANTIZATIONS);
  if (quantizations) config.quantizations = quantizations;

  const allowFallbacks = parseBoolish(env.OPENROUTER_ALLOW_FALLBACKS);
  if (typeof allowFallbacks === 'boolean') config.allow_fallbacks = allowFallbacks;

  const requireParameters = parseBoolish(env.OPENROUTER_REQUIRE_PARAMETERS);
  if (typeof requireParameters === 'boolean') config.require_parameters = requireParameters;

  const zdr = parseBoolish(env.OPENROUTER_ZDR);
  if (typeof zdr === 'boolean') config.zdr = zdr;

  const dataPolicy = env.OPENROUTER_DATA_COLLECTION?.toLowerCase();
  if (dataPolicy === 'allow' || dataPolicy === 'deny') config.data_collection = dataPolicy;

  const maxPrice: Record<string, number> = {};
  const promptPrice = parseNumber(env.OPENROUTER_PROVIDER_MAX_PRICE_PROMPT);
  if (typeof promptPrice === 'number') maxPrice.prompt = promptPrice;
  const completionPrice = parseNumber(env.OPENROUTER_PROVIDER_MAX_PRICE_COMPLETION);
  if (typeof completionPrice === 'number') maxPrice.completion = completionPrice;
  const requestPrice = parseNumber(env.OPENROUTER_PROVIDER_MAX_PRICE_REQUEST);
  if (typeof requestPrice === 'number') maxPrice.request = requestPrice;
  const imagePrice = parseNumber(env.OPENROUTER_PROVIDER_MAX_PRICE_IMAGE);
  if (typeof imagePrice === 'number') maxPrice.image = imagePrice;
  if (Object.keys(maxPrice).length > 0) config.max_price = maxPrice;

  return config;
}

function buildOpenRouterHeaders(env: Bindings): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (env.OPENROUTER_HTTP_REFERER) headers['HTTP-Referer'] = env.OPENROUTER_HTTP_REFERER;
  if (env.OPENROUTER_APP_TITLE) headers['X-Title'] = env.OPENROUTER_APP_TITLE;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function wsRoute(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('Expected a websocket connection', 426);
  }

  const logger = createLogger();
  const clientIP = getClientIP(c.req.raw);
  if (!trackConnection(clientIP)) {
    return c.text('Too many connections from your IP. Please try again later.', 429);
  }

  const { GROQ_API_KEY, FIREWORKS_API_KEY, DEEPGRAM_API_KEY, SIMPLISMART_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY } = c.env;
  const [client, server] = Object.values(new WebSocketPair());

  let session = createEmptySession();
  // Connection-level timestamp: must remain stable even if we reset session state on `start`.
  const wsAcceptAt = Date.now();
  session.wsAcceptAt = wsAcceptAt;
  let socketClosed = false;
  let sttAbort: AbortController | null = null;
  let sessionActive = false;
  let finalSent = false;
  let completionLogged = false;

  // Always have a trace ID for correlating logs, even if the client never sends one
  // (e.g. auth timeout). If the client provides a traceId in auth/start, we adopt it.
  let traceId: string = crypto.randomUUID();
  session.traceId = traceId;

  let connLog = createLogger({ ip: clientIP }).with({ traceId });

  // Timing metrics for consolidated logging
  let authDurationMs = 0;
  let authWasColdStart = false;
  let ocrDurationMs = 0;
  let sttDurationMs = 0;
  let sttTtfbMs = 0;
  let llmDurationMs = 0;
  let llmTtfbMs = 0;
  let routerOverheadMs = 0;  // Time between STT complete → LLM start
  let sttProvider = '';
  let sttModel = '';

  // Helper function to log session completion AND write to Analytics Engine
  const trackSessionCompletion = (data: {
    outcome: 'success' | 'error_auth' | 'error_stt' | 'error_llm' | 'error_send' | 'client_disconnect' | 'timeout' | 'crash';
    mode: 'dictation' | 'edit';
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
    error_stage?: 'auth' | 'ocr' | 'stt' | 'llm' | 'send';
    error_message?: string;
  }) => {
    // Log to console (for Workers Logs dashboard)
    logSessionComplete(data);

    // Track in Analytics Engine (for long-term analysis)
    trackSessionLifecycle(c.env.ANALYTICS_ENGINE, {
      trace_id: data.trace_id,
      user_id: data.user_id,
      outcome: data.outcome,
      mode: data.mode,
      error_stage: data.error_stage,
      error_message: data.error_message,
      stt_provider: data.stt_provider,
      llm_provider: data.llm_provider,
      worker_lifetime_ms: data.worker_lifetime_ms,
      auth_ms: data.auth_ms,
      ocr_ms: data.ocr_ms,
      first_frame_latency_ms: data.first_frame_latency_ms,
      audio_streaming_ms: data.audio_streaming_ms,
      assemble_ms: data.assemble_ms,
      stt_ms: data.stt_ms,
      router_overhead_ms: routerOverheadMs,
      llm_ms: data.llm_ms,
      total_processing_ms: data.total_processing_ms,
      overhead_ms: data.overhead_ms,
      audio_frames: session.frames,
      audio_bytes_kb: Number((session.totalBytes / 1024).toFixed(2)),
      seq_gaps: session.seqGaps,
      cold_start: authWasColdStart,
    });
  };

  server.accept();

  // --------------------------------------------------------------------------
  // AUTH STATE
  // --------------------------------------------------------------------------
  // Whether SKIP_AUTH is enabled (for local dev)
  const skipAuth = parseBoolish(c.env.SKIP_AUTH) === true;

  // Auth state — must be authenticated before processing starts
  let authenticated = skipAuth; // Start authenticated if SKIP_AUTH is set
  let authenticatedUserId: string | null = null;
  let authenticatedEmail: string | null = null;
  let authenticatedSubscriptionActive = false; // Track if user has active subscription (for quota enforcement)
  let authTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Set up auth timeout — close connection if no auth within timeout
  if (!skipAuth) {
    authTimeoutHandle = setTimeout(() => {
      if (!authenticated && !socketClosed) {
        logSessionAuth({
          outcome: 'timeout',
          duration_ms: AUTH_TIMEOUT_MS,
          cold_start: false,
          trace_id: traceId,
        });
        if (!completionLogged) {
          const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
          trackSessionCompletion({
            outcome: 'timeout',
            mode: session.mode,
            worker_lifetime_ms: workerLifetimeMs,
            auth_ms: authDurationMs,
            ocr_ms: ocrDurationMs,
            first_frame_latency_ms: null,
            audio_streaming_ms: null,
            assemble_ms: 0,
            stt_ms: sttDurationMs,
            llm_ms: llmDurationMs,
            total_processing_ms: sttDurationMs + llmDurationMs,
            overhead_ms: Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - sttDurationMs - llmDurationMs),
            trace_id: traceId,
            user_id: authenticatedUserId ?? undefined,
            error_stage: 'auth',
            error_message: 'auth timeout',
          });
          completionLogged = true;
        }
        safely(() =>
          server.send(
            JSON.stringify({
              type: 'auth_error',
              error: 'Authentication timeout - please send auth message',
              code: WS_CLOSE_CODES.AUTH_TIMEOUT,
            }),
          ),
        );
        safeClose(server, WS_CLOSE_CODES.AUTH_TIMEOUT, 'auth timeout');
        releaseConnection(clientIP);
      }
    }, AUTH_TIMEOUT_MS);
  }

  // Track optional language from client
  let clientLanguage: string | undefined = undefined;

  server.addEventListener('message', async (evt: MessageEvent) => {
    try {
      const data = evt.data;
      if (typeof data === 'string') {
        const msg = safeJson(data);
        const parsed = parseClientMessage(msg);
        if (!parsed) return;

        // --------------------------------------------------------------------------
        // AUTH MESSAGE HANDLER
        // --------------------------------------------------------------------------
        if (parsed.type === 'auth') {
          // Clear auth timeout since we received an auth attempt
          if (authTimeoutHandle) {
            clearTimeout(authTimeoutHandle);
            authTimeoutHandle = null;
          }

          // Don't process if already authenticated
          if (authenticated) {
            connLog.warn('[WS] duplicate auth ignored');
            return;
          }

          // Adopt client-provided traceId ASAP so auth logs correlate with the session.
          if (parsed.traceId && parsed.traceId !== traceId) {
            traceId = parsed.traceId;
            session.traceId = traceId;
            connLog = connLog.with({ traceId });
          }

          const { token } = parsed;
          if (!token) {
            logSessionAuth({
              outcome: 'missing_token',
              duration_ms: 0,
              cold_start: false,
              trace_id: traceId,
            });
            if (!completionLogged) {
              const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
              trackSessionCompletion({
                outcome: 'error_auth',
                mode: session.mode,
                worker_lifetime_ms: workerLifetimeMs,
                auth_ms: authDurationMs,
                ocr_ms: ocrDurationMs,
                first_frame_latency_ms: null,
                audio_streaming_ms: null,
                assemble_ms: 0,
                stt_ms: sttDurationMs,
                llm_ms: llmDurationMs,
                total_processing_ms: sttDurationMs + llmDurationMs,
                overhead_ms: Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - sttDurationMs - llmDurationMs),
                trace_id: traceId,
                user_id: authenticatedUserId ?? undefined,
                error_stage: 'auth',
                error_message: 'missing token',
              });
              completionLogged = true;
            }
            safely(() =>
              server.send(
                JSON.stringify({
                  type: 'auth_error',
                  error: 'Token is required',
                  code: WS_CLOSE_CODES.UNAUTHORIZED,
                }),
              ),
            );
            safeClose(server, WS_CLOSE_CODES.UNAUTHORIZED, 'missing token');
            releaseConnection(clientIP);
            return;
          }

          // Verify JWT
          const supabaseUrl = c.env.SUPABASE_URL;
          if (!supabaseUrl) {
            console.error('[Auth] SUPABASE_URL not configured');
            if (!completionLogged) {
              const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
              trackSessionCompletion({
                outcome: 'error_auth',
                mode: session.mode,
                worker_lifetime_ms: workerLifetimeMs,
                auth_ms: authDurationMs,
                ocr_ms: ocrDurationMs,
                first_frame_latency_ms: null,
                audio_streaming_ms: null,
                assemble_ms: 0,
                stt_ms: sttDurationMs,
                llm_ms: llmDurationMs,
                total_processing_ms: sttDurationMs + llmDurationMs,
                overhead_ms: Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - sttDurationMs - llmDurationMs),
                trace_id: traceId,
                user_id: authenticatedUserId ?? undefined,
                error_stage: 'auth',
                error_message: 'SUPABASE_URL not configured',
              });
              completionLogged = true;
            }
            safely(() =>
              server.send(
                JSON.stringify({
                  type: 'auth_error',
                  error: 'Server configuration error',
                  code: WS_CLOSE_CODES.UNAUTHORIZED,
                }),
              ),
            );
            safeClose(server, WS_CLOSE_CODES.UNAUTHORIZED, 'server config error');
            releaseConnection(clientIP);
            return;
          }

          // Track JWT verification timing (including JWKS fetch on cold start)
          const jwtStartAt = Date.now();
          const jwtResult = await verifySupabaseJwt(token, supabaseUrl);
          const jwtDurationMs = Date.now() - jwtStartAt;

          // Store auth metrics for consolidated logging
          authDurationMs = jwtDurationMs;
          authWasColdStart = jwtDurationMs > 500;  // JWKS fetch adds 300-800ms

          // NOTE: JWT verification metrics are now tracked in session.lifecycle (trackSessionCompletion)
          // Old event 'auth.jwt_verify' is deprecated - can be removed once migration is verified in production

          if (jwtResult.valid === false) {
            logSessionAuth({
              outcome: 'invalid',
              duration_ms: jwtDurationMs,
              cold_start: authWasColdStart,
              trace_id: traceId,
            });
            if (!completionLogged) {
              const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
              trackSessionCompletion({
                outcome: 'error_auth',
                mode: session.mode,
                worker_lifetime_ms: workerLifetimeMs,
                auth_ms: authDurationMs,
                ocr_ms: ocrDurationMs,
                first_frame_latency_ms: null,
                audio_streaming_ms: null,
                assemble_ms: 0,
                stt_ms: sttDurationMs,
                llm_ms: llmDurationMs,
                total_processing_ms: sttDurationMs + llmDurationMs,
                overhead_ms: Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - sttDurationMs - llmDurationMs),
                trace_id: traceId,
                user_id: authenticatedUserId ?? undefined,
                error_stage: 'auth',
                error_message: jwtResult.error,
              });
              completionLogged = true;
            }
            safely(() =>
              server.send(
                JSON.stringify({
                  type: 'auth_error',
                  error: jwtResult.code === 'expired' ? 'Token has expired' : 'Invalid token',
                  code: WS_CLOSE_CODES.UNAUTHORIZED,
                }),
              ),
            );
            safeClose(server, WS_CLOSE_CODES.UNAUTHORIZED, jwtResult.error);
            releaseConnection(clientIP);
            return;
          }

          // JWT is valid — check subscription or quota
          if (!jwtResult.subscriptionActive) {
            // Free tier user - check quota
            const wordsUsed = jwtResult.wordsUsedThisWeek ?? 0;
            const quotaLimit = jwtResult.quotaLimit ?? 1000;

            if (wordsUsed >= quotaLimit) {
              // Quota exceeded - block
              logSessionAuth({
                outcome: 'quota_exceeded',
                duration_ms: jwtDurationMs,
                cold_start: authWasColdStart,
                trace_id: traceId,
                user_id: jwtResult.userId,
              });
              if (!completionLogged) {
                const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
                trackSessionCompletion({
                  outcome: 'error_auth',
                  mode: session.mode,
                  worker_lifetime_ms: workerLifetimeMs,
                  auth_ms: authDurationMs,
                  ocr_ms: ocrDurationMs,
                  first_frame_latency_ms: null,
                  audio_streaming_ms: null,
                  assemble_ms: 0,
                  stt_ms: sttDurationMs,
                  llm_ms: llmDurationMs,
                  total_processing_ms: sttDurationMs + llmDurationMs,
                  overhead_ms: Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - sttDurationMs - llmDurationMs),
                  trace_id: traceId,
                  user_id: authenticatedUserId ?? undefined,
                  error_stage: 'auth',
                  error_message: 'quota exceeded',
                });
                completionLogged = true;
              }
              safely(() =>
                server.send(
                  JSON.stringify({
                    type: 'auth_error',
                    error: 'Free words used up this week',
                    code: WS_CLOSE_CODES.QUOTA_EXCEEDED,
                  }),
                ),
              );
              safeClose(server, WS_CLOSE_CODES.QUOTA_EXCEEDED, 'quota exceeded');
              releaseConnection(clientIP);
              return;
            }
          }

          // Success! Mark as authenticated (works for both Pro and Free users)
          authenticated = true;
          authenticatedUserId = jwtResult.userId;
          authenticatedEmail = jwtResult.email;
          authenticatedSubscriptionActive = jwtResult.subscriptionActive;

          // Log successful authentication
          logSessionAuth({
            outcome: 'success',
            duration_ms: jwtDurationMs,
            cold_start: authWasColdStart,
            trace_id: traceId,
            user_id: jwtResult.userId,
          });

          // Send auth success
          safely(() =>
            server.send(
              JSON.stringify({
                type: 'auth_ok',
                userId: jwtResult.userId,
              }),
            ),
          );
          return;
        }

        // --------------------------------------------------------------------------
        // REQUIRE AUTH FOR ALL OTHER MESSAGES
        // --------------------------------------------------------------------------
        if (!authenticated) {
          console.log(JSON.stringify({
            event: 'auth.required',
            clientIP,
            messageType: parsed.type,
          }));
          if (!completionLogged) {
            const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
            trackSessionCompletion({
              outcome: 'error_auth',
              mode: session.mode,
              worker_lifetime_ms: workerLifetimeMs,
              auth_ms: authDurationMs,
              ocr_ms: ocrDurationMs,
              first_frame_latency_ms: null,
              audio_streaming_ms: null,
              assemble_ms: 0,
              stt_ms: sttDurationMs,
              llm_ms: llmDurationMs,
              total_processing_ms: sttDurationMs + llmDurationMs,
              overhead_ms: Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - sttDurationMs - llmDurationMs),
              trace_id: traceId,
              user_id: authenticatedUserId ?? undefined,
              error_stage: 'auth',
              error_message: `auth required: ${parsed.type}`,
            });
            completionLogged = true;
          }
          safely(() =>
            server.send(
              JSON.stringify({
                type: 'auth_error',
                error: 'Authentication required - send auth message first',
                code: WS_CLOSE_CODES.UNAUTHORIZED,
              }),
            ),
          );
          safeClose(server, WS_CLOSE_CODES.UNAUTHORIZED, 'not authenticated');
          releaseConnection(clientIP);
          return;
        }

        // --------------------------------------------------------------------------
        // AUTHENTICATED MESSAGE HANDLERS
        // --------------------------------------------------------------------------
        if (parsed.type === 'start') {
          if (sessionActive) {
            connLog.warn('[WS] duplicate start ignored');
            return;
          }
          sessionActive = true;
          session = createEmptySession();
          // Preserve connection-level timing across session resets.
          session.wsAcceptAt = wsAcceptAt;
          session.startedAt = Date.now();
          session.version = parsed.version ?? 1;
          session.format = parsed.format ?? 'pcm16le';
          session.rate = parsed.rate ?? 16000;
          if (parsed.traceId && parsed.traceId !== traceId) {
            traceId = parsed.traceId;
            connLog = connLog.with({ traceId });
          }
          session.traceId = traceId;
          clientLanguage = parsed.language;
          session.mode = parsed.mode ?? 'dictation';
          session.selection = parsed.selection ?? null;
          session.shareTranscriptions = parsed.shareTranscriptions === true;
          session.identity = {
            name: parsed.identity?.name ?? null,
            email: parsed.identity?.email ?? null,
          };
        } else if (parsed.type === 'end') {
          const t0 = Date.now();
          session.processingStartAt = t0;
          if (!socketClosed) {
            const ok = safely(() =>
              server.send(
                JSON.stringify({
                  type: 'status',
                  state: 'processing',
                  traceId: session.traceId,
                  serverTs: Date.now(),
                }),
              ),
            );
            if (!ok) connLog.error('[WS] status send failed');
          }

          // For empty sessions (no audio), return empty
          if (session.canceled || (session.chunks.length === 0 || session.totalBytes === 0)) {
            const text = '';
            server.send(JSON.stringify({ type: 'final', text }));
            safeClose(server, 1000, 'done');
            session = createEmptySession();
            sessionActive = false;
            return;
          }

          const assembleStart = Date.now();

          // Process audio (single-shot, no chunking)
          let remainingWav: Uint8Array | null = null;
          if (session.chunks.length > 0 && session.totalBytes > 0) {
            const pcm = concat(session.chunks, session.totalBytes);
            remainingWav = wrapWav(pcm, session.rate, 1, 16);
          }

          const assembleMs = Date.now() - assembleStart;

          let finalText = '';
          let timings: { startAt: number; headersAt: number; bodyDoneAt: number } | null = null;
          let llmText = '';
          let llmTimings: { startAt: number; headersAt: number; firstDeltaAt?: number; bodyDoneAt: number } | null = null;
          let llmSuccess = false;
          let llmProvider: string | null = null;
          let llmModel: string | null = null;
          let llmRouteRules: string[] = [];
          let triggeredRules: string[] = []; // New: triggers detected by smart router
          let promptTokens: number = 0; // New: estimated prompt token count
          let llmBypassed: boolean = false; // New: was LLM skipped entirely?
          let modelTier: string = ''; // New: which tier was used (bypass/default/advanced/edit)

          const runtime = getRuntimeConfig(c.env);
          const runtimeSttProvider = runtime.stt.provider;
          sttProvider = runtimeSttProvider;
          sttModel = runtime.stt.model;

          try {
            const sttApiKey =
              runtimeSttProvider === 'fireworks'
                ? FIREWORKS_API_KEY
                : runtimeSttProvider === 'deepgram'
                  ? DEEPGRAM_API_KEY
                  : runtimeSttProvider === 'simplismart'
                    ? SIMPLISMART_API_KEY
                    : GROQ_API_KEY;
            const sttEndpoint =
              runtimeSttProvider === 'fireworks'
                ? FIREWORKS_STT_TURBO_ENDPOINT
                : runtimeSttProvider === 'deepgram'
                  ? DEEPGRAM_STT_ENDPOINT
                  : runtimeSttProvider === 'simplismart'
                    ? SIMPLISMART_STT_ENDPOINT
                    : GROQ_STT_ENDPOINT;


            if (sttApiKey) {
              sttAbort?.abort();
              sttAbort = new AbortController();
              const sttPrompt = buildSTTPrompt({
                basePrompt: runtime.stt.prompt,
                identity: session.identity,
                ocrWords: session.ocrWords.length > 0 ? session.ocrWords : undefined,
              });

              // Single-shot processing (chunking disabled)
              const wav = remainingWav!;

              // Log audio received
              logSessionAudio({
                frames: session.frames,
                bytes_kb: Number((session.totalBytes / 1024).toFixed(2)),
                streaming_duration_ms: session.firstArrivalMs && session.lastArrivalMs
                  ? session.lastArrivalMs - session.firstArrivalMs
                  : null,
                seq_gaps: session.seqGaps,
                trace_id: session.traceId ?? 'unknown',
              });

              const sttStartTime = Date.now();
              const res = await transcribeWav(wav, {
                provider: runtimeSttProvider,
                apiKey: sttApiKey,
                signal: sttAbort.signal,
                model: runtime.stt.model,
                language: clientLanguage || runtime.stt.language,
                prompt: sttPrompt,
                timeoutMs: runtime.stt.timeoutMs,
              });
              const sttDuration = Date.now() - sttStartTime;
              finalText = res.text;
              timings = res.timings;

              // Track STT metrics
              sttDurationMs = sttDuration;
              sttTtfbMs = timings ? timings.headersAt - timings.startAt : 0;

              // Log STT completion
              logSessionSTT({
                outcome: 'success',
                provider: runtimeSttProvider,
                model: runtime.stt.model,
                duration_ms: sttDuration,
                ttfb_ms: sttTtfbMs,
                text_length: finalText.length,
                trace_id: session.traceId ?? 'unknown',
              });

              const editPlan =
                session.mode === 'edit' && runtime.edit.enabled
                  ? prepareEditRequest({
                    instructions: finalText,
                    selection: session.selection,
                  })
                  : null;


              // Optional LLM post-process
              const enableLLM = runtime.llm.enabled && !editPlan;
              if (editPlan) {
                safely(() =>
                  server.send(
                    JSON.stringify({
                      type: 'llm_status',
                      state: 'llm_processing',
                      traceId: session.traceId,
                      serverTs: Date.now(),
                    }),
                  ),
                );

                // EDIT MODE: Always use edit tier
                const editRouteDecision = selectEditRoute(runtime);
                modelTier = editRouteDecision.tier;
                const provider = editRouteDecision.provider!;
                const model = editRouteDecision.model!;
                llmProvider = provider;
                llmModel = model;
                const apiKeyForProvider =
                  provider === 'openai'
                    ? c.env.OPENAI_API_KEY
                    : provider === 'baseten'
                      ? c.env.BASETEN_API_KEY
                      : provider === 'openrouter'
                        ? OPENROUTER_API_KEY
                        : provider === 'cerebras'
                          ? CEREBRAS_API_KEY
                          : provider === 'simplismart'
                            ? SIMPLISMART_API_KEY
                            : provider === 'groq'
                              ? GROQ_API_KEY
                              : undefined;

                if (apiKeyForProvider) {
                  try {
                    const llmEndpoint =
                      provider === 'openai'
                        ? OPENAI_LLM_ENDPOINT
                        : provider === 'baseten'
                          ? BASETEN_LLM_ENDPOINT
                          : provider === 'openrouter'
                            ? OPENROUTER_LLM_ENDPOINT
                            : provider === 'cerebras'
                              ? CEREBRAS_LLM_ENDPOINT
                              : GROQ_LLM_ENDPOINT;
                    const editLog = {
                      event: 'edit.request',
                      provider,
                      model,
                      endpoint: llmEndpoint,
                      timeoutMs: runtime.edit.timeoutMs,
                      stream: runtime.edit.stream,
                      traceId: session.traceId,
                    } as const;
                    console.log(JSON.stringify(editLog));
                  } catch { }
                  const editStartTime = Date.now();
                  try {
                    const streamEdit = runtime.edit.stream;
                    const editRes = await chatCompleteByProvider(provider, {
                      apiKey: apiKeyForProvider,
                      model,
                      systemPrompt: buildEditSystemPrompt({ sttPrompt }),
                      userContent: editPlan.prompt,
                      stream: streamEdit,
                      temperature: runtime.edit.temperature,
                      timeoutMs: runtime.edit.timeoutMs,
                      signal: sttAbort.signal,
                      providerConfig:
                        provider === 'openrouter'
                          ? buildOpenRouterProviderConfig(c.env)
                          : undefined,
                      extraHeaders:
                        provider === 'openrouter'
                          ? buildOpenRouterHeaders(c.env)
                          : undefined,
                      onDelta: streamEdit
                        ? (delta) => {
                          if (!socketClosed && delta) {
                            safely(() =>
                              server.send(
                                JSON.stringify({
                                  type: 'llm_delta',
                                  delta,
                                  traceId: session.traceId,
                                }),
                              ),
                            );
                          }
                        }
                        : undefined,
                    });
                    llmSuccess = Boolean(editRes.text && editRes.text.length > 0);
                    llmText = editRes.text || editPlan.originalText;
                    llmTimings = editRes.timings;
                    const editDuration = Date.now() - editStartTime;
                    // Log edit completion
                    try {
                      const editCompleteLog = {
                        event: 'edit.complete',
                        provider,
                        durationMs: editDuration,
                        textLength: llmText.length,
                        success: llmSuccess,
                        traceId: session.traceId,
                      } as const;
                      console.log(JSON.stringify(editCompleteLog));
                    } catch { }
                  } catch (error) {
                    const editDuration = Date.now() - editStartTime;
                    // Log edit error
                    try {
                      const editErrorLog = {
                        event: 'edit.error',
                        provider,
                        durationMs: editDuration,
                        error: String(error),
                        errorName: (error as any)?.name,
                        traceId: session.traceId,
                      } as const;
                      console.log(JSON.stringify(editErrorLog));
                    } catch { }
                    llmText = editPlan.originalText;
                  }
                } else {
                  llmText = editPlan.originalText;
                }
              } else if (enableLLM && finalText) {
                // Track router overhead (time between STT complete → LLM start)
                const routerStartTime = Date.now();

                // SMART ROUTING: Detect triggers and route to appropriate tier
                const triggerContext = detectTriggers(finalText);
                const routeDecision = selectSmartRoute(finalText, triggerContext, runtime);

                // Track smart routing metrics
                modelTier = routeDecision.tier;
                triggeredRules = routeDecision.triggeredRules;

                // BYPASS: No LLM needed - use raw STT
                if (routeDecision.tier === 'bypass') {
                  llmBypassed = true;
                  llmText = finalText;
                  llmSuccess = true;
                  promptTokens = 0;

                  // Log bypass
                  try {
                    const bypassLog = {
                      event: 'llm.bypassed',
                      reason: routeDecision.reason,
                      textLength: finalText.length,
                      traceId: session.traceId,
                    } as const;
                    console.log(JSON.stringify(bypassLog));
                  } catch { }
                } else {
                  // LLM PROCESSING: default or advanced tier
                  // Notify client that LLM processing starts
                  safely(() =>
                    server.send(
                      JSON.stringify({
                        type: 'llm_status',
                        state: 'llm_processing',
                        traceId: session.traceId,
                        serverTs: Date.now(),
                      }),
                    ),
                  );

                const streamLLM = routeDecision.stream ?? runtime.llm.stream;
                const provider = routeDecision.provider!;
                const model = routeDecision.model!;
                llmProvider = provider;
                llmModel = model;
                llmRouteRules = triggeredRules;
                const apiKeyForProvider =
                  provider === 'openai'
                    ? c.env.OPENAI_API_KEY
                    : provider === 'baseten'
                      ? c.env.BASETEN_API_KEY
                      : provider === 'openrouter'
                        ? OPENROUTER_API_KEY
                        : provider === 'cerebras'
                          ? CEREBRAS_API_KEY
                          : provider === 'simplismart'
                            ? SIMPLISMART_API_KEY
                            : GROQ_API_KEY;

                if (apiKeyForProvider) {
                  const llmStartTime = Date.now();
                  routerOverheadMs = llmStartTime - routerStartTime;

                  // DYNAMIC PROMPT: Compose based on detected triggers
                  const systemPrompt = composeDynamicPrompt(triggerContext, {
                    vocabulary: sttPrompt,
                    model,
                    currentDate: runtime.llm.currentDate,
                  });
                  promptTokens = estimatePromptTokens(systemPrompt);

                  const llmRes = await chatCompleteByProvider(provider, {
                    apiKey: apiKeyForProvider,
                    model,
                    systemPrompt,
                    userContent: finalText,
                    stream: streamLLM,
                    temperature: routeDecision.temperature ?? runtime.llm.temperature,
                    timeoutMs: routeDecision.timeoutMs,
                    signal: sttAbort.signal,
                    providerConfig:
                      provider === 'openrouter'
                        ? buildOpenRouterProviderConfig(c.env)
                        : undefined,
                    extraHeaders:
                      provider === 'openrouter'
                        ? buildOpenRouterHeaders(c.env)
                        : undefined,
                    onDelta: (delta) => {
                      if (!socketClosed && streamLLM && delta) {
                        safely(() =>
                          server.send(
                            JSON.stringify({ type: 'llm_delta', delta, traceId: session.traceId }),
                          ),
                        );
                      }
                    },
                  });
                  const llmDuration = Date.now() - llmStartTime;
                  llmText = llmRes.text || '';
                  llmTimings = llmRes.timings;
                  llmSuccess = llmText.length > 0;

                  // Track LLM metrics
                  llmDurationMs = llmDuration;
                  llmTtfbMs = llmTimings
                    ? (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt
                    : 0;

                  // Log LLM completion
                  logSessionLLM({
                    outcome: 'success',
                    provider,
                    model,
                    duration_ms: llmDuration,
                    ttfb_ms: llmTtfbMs,
                    router_overhead_ms: routerOverheadMs,
                    text_length: llmText.length,
                    trace_id: session.traceId ?? 'unknown',
                  });
                }
                } // Close else block for LLM processing (bypass vs process)
              }

              if (llmText) {
                // LLM succeeded - metrics removed
              } else {
                // LLM disabled or failed - metrics removed
              }
              // Dataset logging: ASR→LLM input and LLM output
              // Dataset logging: ASR→LLM input and LLM output
              // Comment out this block to disable dataset logging.
              if (session.shareTranscriptions) {
                try {
                  const datasetLlmConfig = session.mode === 'edit'
                    ? { provider: runtime.edit.provider, model: runtime.edit.model }
                    : { provider: llmProvider ?? runtime.llm.provider, model: llmModel ?? runtime.llm.model };

                  if (session.mode === 'edit') {
                    const editPlanForDataset = prepareEditRequest({
                      instructions: finalText,
                      selection: session.selection,
                    });

                    try {
                      const datasetEntry = {
                        event: 'dataset.edit_io',
                        traceId: session.traceId,
                        'session.trace_id': session.traceId,
                        language: clientLanguage || runtime.stt.language,
                        instructions: finalText,
                        inputText: editPlanForDataset?.originalText ?? session.selection?.text ?? null,
                        outputText: llmText || null,
                        llm: datasetLlmConfig,
                        selectionSource: session.selection?.source ?? null,
                        ts: Date.now(),
                      } as const;
                      console.log(JSON.stringify(datasetEntry));
                    } catch { }
                  } else {
                    try {
                      const datasetEntryForStt = {
                        event: 'dataset.llm_io',
                        traceId: session.traceId,
                        'session.trace_id': session.traceId,
                        language: clientLanguage || runtime.stt.language,
                        sttText: finalText,
                        llmText: llmText || null,
                        llm: datasetLlmConfig,
                        mode: session.mode,
                        ts: Date.now(),
                      } as const;
                      console.log(JSON.stringify(datasetEntryForStt));
                    } catch { }
                  }
                } catch { }
              }
            } else {
              finalText = '';
              connLog.error('[WS] missing STT API key', { provider: sttProvider });
            }
          } catch (e: any) {
            safely(() => sttAbort?.abort());
            const errorMsg = String(e?.message || e || '');
            const isAbortError = e?.name === 'AbortError' || errorMsg.includes('abort');
            const isExpectedAbort = isAbortError && (session.canceled || socketClosed);

            // Determine which stage failed based on whether we got STT results
            const failedStage = finalText ? 'llm' : 'stt';

            if (!isExpectedAbort) {
              logSessionError({
                stage: failedStage,
                error_type: String(e?.name || 'Unknown'),
                error_message: errorMsg || 'unknown error',
                provider: failedStage === 'stt' ? sttProvider : llmProvider,
                trace_id: traceId,
              });
            }

            // Log detailed error information
            if (!isExpectedAbort) {
              try {
                const errorLog = {
                  event: 'pipeline.error',
                  stage: failedStage,
                  errorName: e?.name || 'Unknown',
                  errorMessage: errorMsg,
                  isAbortError,
                  isTimeout: errorMsg.includes('timeout') || errorMsg.includes('timed out') || isAbortError,
                  sttCompleted: !!finalText,
                  traceId: session.traceId,
                } as const;
                console.log(JSON.stringify(errorLog));
              } catch { }
            }

            if (!socketClosed) {
              // Determine error code based on error type
              let errorCode = 4001; // STT_API_ERROR default
              if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
                errorCode = 4002; // STT_TIMEOUT
              } else if (isAbortError) {
                errorCode = 4004; // AUDIO_PROCESSING_FAILED
              }
              const errorBody = failedStage === 'llm'
                ? `LLM processing failed: ${e?.message || 'Unknown error'}`
                : `STT failed: ${e?.message || 'Unknown error'}`;
              const ok = safely(() => server.send(
                JSON.stringify({ type: 'error', code: errorCode, body: errorBody, retryable: errorCode === 4002 })
              ));
              if (!ok) connLog.error('[WS] error send failed');
              safeClose(server, 1011, `${failedStage} error`);
            }

            // Only log unexpected errors; expected aborts are normal flow
            if (!isExpectedAbort) {
              connLog.error(`[WS] ${failedStage.toUpperCase()} error`, { error: String(e), stage: failedStage });
            }

            // Log session failure
            const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
            const firstFrameLatencyMs = wsAcceptAt && session.firstArrivalMs
              ? session.firstArrivalMs - wsAcceptAt
              : null;
            const audioStreamingMs = session.firstArrivalMs && session.lastArrivalMs
              ? session.lastArrivalMs - session.firstArrivalMs
              : null;
            const totalProcessingMs = sttDurationMs + llmDurationMs;
            const overheadMs = Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - totalProcessingMs - assembleMs);

            trackSessionCompletion({
              outcome: failedStage === 'stt' ? 'error_stt' : 'error_llm',
              mode: session.mode,
              worker_lifetime_ms: workerLifetimeMs,
              auth_ms: authDurationMs,
              ocr_ms: ocrDurationMs,
              first_frame_latency_ms: firstFrameLatencyMs,
              audio_streaming_ms: audioStreamingMs,
              assemble_ms: assembleMs,
              stt_ms: sttDurationMs,
              llm_ms: llmDurationMs,
              total_processing_ms: totalProcessingMs,
              overhead_ms: overheadMs,
              trace_id: session.traceId ?? 'unknown',
              user_id: authenticatedUserId ?? undefined,
              stt_provider: sttProvider,
              llm_provider: llmProvider,
              error_stage: failedStage as 'stt' | 'llm',
              error_message: String(e?.message || e || 'Unknown error'),
            });
            completionLogged = true;

            session = createEmptySession();
            sessionActive = false;
            return;
          }

          if (!socketClosed) {
            try {
              const workerMetrics = {
                traceId: session.traceId,
                wsAcceptAt: wsAcceptAt ?? null,
                startedAt: session.startedAt ?? null,
                processingStartAt: session.processingStartAt ?? null,
                frames: session.frames,
                bytes: session.totalBytes,
                seqGaps: session.seqGaps,
                firstArrivalMs: session.firstArrivalMs,
                lastArrivalMs: session.lastArrivalMs,
                firstToLastArrivalMs:
                  session.firstArrivalMs && session.lastArrivalMs
                    ? session.lastArrivalMs - session.firstArrivalMs
                    : null,
                assembleMs,
                mode: session.mode,
                stt: timings
                  ? {
                    provider: sttProvider,
                    model: runtime.stt.model,
                    startAt: timings.startAt,
                    headersAt: timings.headersAt,
                    bodyDoneAt: timings.bodyDoneAt,
                    ttfbMs: timings.headersAt - timings.startAt,
                    bodyMs: timings.bodyDoneAt - timings.headersAt,
                    totalMs: timings.bodyDoneAt - timings.startAt,
                  }
                  : null,
                llm: llmTimings || modelTier
                  ? {
                    // LLM call metrics (only if LLM was invoked)
                    ...(llmTimings ? {
                      provider: llmProvider,
                      model: llmModel,
                      startAt: llmTimings.startAt,
                      headersAt: llmTimings.headersAt,
                      firstDeltaAt: llmTimings.firstDeltaAt ?? null,
                      bodyDoneAt: llmTimings.bodyDoneAt,
                      ttfbMs: (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt,
                      bodyMs: llmTimings.bodyDoneAt - (llmTimings.firstDeltaAt ?? llmTimings.headersAt),
                      totalMs: llmTimings.bodyDoneAt - llmTimings.startAt,
                      routeRules: llmRouteRules.length ? llmRouteRules : null,
                    } : {}),
                    // Smart routing metrics (always included when router is active)
                    tier: modelTier || null,
                    triggeredRules: triggeredRules.length ? triggeredRules : null,
                    promptTokens: promptTokens || null,
                    bypassed: llmBypassed,
                  }
                  : null,
                finalSentAt: Date.now(),
              };

              // Count words from STT output (what user actually spoke)
              // NOT from LLM output - in edit mode LLM can generate more/fewer words
              // Example: User says "make it shorter" (3 words) → LLM outputs 70 words
              // We should charge for 3 words (what they spoke), not 70
              const wordCount = finalText.split(/\s+/).filter(Boolean).length;
              const responseText = llmText || finalText;

              // Fire-and-forget: increment quota in DB for free tier users
              // This runs AFTER transcription completes (zero latency impact)
              if (!authenticatedSubscriptionActive && authenticatedUserId && wordCount > 0) {
                const supabaseUrl = c.env.SUPABASE_URL;
                const supabaseKey = c.env.SUPABASE_SERVICE_ROLE_KEY;

                if (supabaseUrl && supabaseKey) {
                  // Fire-and-forget quota update (doesn't block response)
                  c.executionCtx.waitUntil(
                    (async () => {
                      const quotaStartAt = Date.now();
                      let quotaSuccess = false;
                      let quotaError: string | undefined;

                      try {
                        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_quota_simple`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${supabaseKey}`,
                          },
                          body: JSON.stringify({
                            p_user_id: authenticatedUserId,
                            p_word_count: wordCount, // INCREMENT by this amount
                          }),
                        });

                        quotaSuccess = response.ok;
                        if (!response.ok) {
                          quotaError = `HTTP ${response.status}`;
                          console.warn('[WS] Quota increment failed:', await response.text());
                        }
                      } catch (error) {
                        quotaSuccess = false;
                        quotaError = error instanceof Error ? error.message : String(error);
                        // Silent fail - quota tracking is non-critical
                        console.warn('[WS] Quota increment error:', error);
                      } finally {
                        // NOTE: Quota increment timing is no longer tracked separately
                        // All session metrics are now in session.lifecycle (trackSessionCompletion)
                        // Old event 'db.quota_increment' is deprecated - can be removed once migration is verified
                        const quotaDurationMs = Date.now() - quotaStartAt;
                        // Removed: trackEvent(c.env.ANALYTICS_ENGINE, { event: 'db.quota_increment', ... });
                      }
                    })()
                  );
                }
              }

              server.send(
                JSON.stringify({
                  type: 'final',
                  text: responseText,
                  wordCount, // Send word count to app for local UI update
                  traceId: session.traceId,
                  // Pass dataset texts for user consent (if shareTranscriptions enabled)
                  dataset: session.shareTranscriptions
                    ? { sttText: finalText, llmText: llmText || null }
                    : null,
                  metrics: { worker: workerMetrics },
                }),
              );
            } catch (error) {
              connLog.error('[WS] final send failed', { error: String(error) });
            }
            safeClose(server, 1000, 'done');
          }

          // Log successful session completion
          const t1 = Date.now();
          const workerLifetimeMs = wsAcceptAt ? t1 - wsAcceptAt : 0;
          const firstFrameLatencyMs = wsAcceptAt && session.firstArrivalMs
            ? session.firstArrivalMs - wsAcceptAt
            : null;
          const audioStreamingMs = session.firstArrivalMs && session.lastArrivalMs
            ? session.lastArrivalMs - session.firstArrivalMs
            : null;
          const totalProcessingMs = sttDurationMs + llmDurationMs;
          const overheadMs = Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - totalProcessingMs - assembleMs);

          trackSessionCompletion({
            outcome: 'success',
            mode: session.mode,
            worker_lifetime_ms: workerLifetimeMs,
            auth_ms: authDurationMs,
            ocr_ms: ocrDurationMs,
            first_frame_latency_ms: firstFrameLatencyMs,
            audio_streaming_ms: audioStreamingMs,
            assemble_ms: assembleMs,
            stt_ms: sttDurationMs,
            llm_ms: llmDurationMs,
            total_processing_ms: totalProcessingMs,
            overhead_ms: overheadMs,
            trace_id: session.traceId ?? 'unknown',
            user_id: authenticatedUserId ?? undefined,
            stt_provider: sttProvider,
            llm_provider: llmProvider || undefined,
          });
          completionLogged = true;
          // Legacy metrics for session_summary (kept for backwards compatibility)
          const sttTtfbMsLegacy = timings ? timings.headersAt - timings.startAt : null;
          const sttBodyMs = timings ? timings.bodyDoneAt - timings.headersAt : null;
          const sttTotalMs = timings ? timings.bodyDoneAt - timings.startAt : null;
          const llmTtfbMsLegacy = llmTimings ? (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt : null;
          const llmBodyMs = llmTimings ? llmTimings.bodyDoneAt - (llmTimings.firstDeltaAt ?? llmTimings.headersAt) : null;
          const llmTotalMs = llmTimings ? llmTimings.bodyDoneAt - llmTimings.startAt : null;
          const llmFirstTokenMs =
            llmTimings?.firstDeltaAt != null && llmTimings?.startAt != null
              ? llmTimings.firstDeltaAt - llmTimings.startAt
              : llmTtfbMsLegacy;
          const finalizationMs = t1 - t0;
          const overheadMsLegacy =
            sttTotalMs != null
              ? Math.max(0, finalizationMs - assembleMs - sttTotalMs - (llmTotalMs ?? 0))
              : Math.max(0, finalizationMs - assembleMs);

          try {
            const wsAccept = wsAcceptAt ?? null;
            const wsAcceptToFinalMs = wsAccept ? t1 - wsAccept : null;
            const pipeline = session.mode === 'edit'
              ? 'edit'
              : llmTotalMs != null
                ? 'stt+llm'
                : 'stt';
            const summary = {
              event: 'transcription.session_summary',
              id: session.traceId ?? null,
              pipeline,
              durations: {
                wsAcceptToFinalMs,
                assembleMs,
                sttMs: sttTotalMs,
                sttTtfbMs: sttTtfbMsLegacy,
                sttBodyMs,
                llmMs: llmTotalMs,
                llmTtfbMs: llmTtfbMsLegacy,
                llmBodyMs,
                llmFirstTokenMs,
                serverProcessingMs: (sttTotalMs ?? 0) + (llmTotalMs ?? 0),
                overheadMs: overheadMsLegacy,
                e2eMs: null,
                captureMs: null,
                deliverMs: null,
                pasteMs: null,
              },
              traffic: {
                frames: session.frames,
                bytesKB: Number((session.totalBytes / 1024).toFixed(2)),
                seqGaps: session.seqGaps,
                firstToLastArrivalMs:
                  session.firstArrivalMs && session.lastArrivalMs
                    ? session.lastArrivalMs - session.firstArrivalMs
                    : null,
              },
              result: { textLen: (llmText || finalText).length },
              llm: llmProvider || modelTier
                ? {
                  provider: llmProvider,
                  model: llmModel,
                  routeRules: llmRouteRules.length ? llmRouteRules : null,
                  tier: modelTier || null,
                  triggeredRules: triggeredRules.length ? triggeredRules : null,
                  promptTokens: promptTokens || null,
                  bypassed: llmBypassed,
                }
                : null,
              edit:
                session.mode === 'edit'
                  ? {
                    instructions: finalText,
                    inputText:
                      prepareEditRequest({
                        instructions: finalText,
                        selection: session.selection,
                      })?.originalText ?? session.selection?.text ?? null,
                    outputText: llmText || null,
                  }
                  : null,
              ws: { closeCode: 1000, closeReason: 'done' },
              env: {},
              containsClientMetrics: false,
            } as const;
            safely(() => console.log(JSON.stringify(summary)));
          } catch (err) {
            connLog.error('[WS] session summary failed', { error: String(err) });
          }
          finalSent = true;
          session = createEmptySession();
          sessionActive = false;
        } else if (parsed.type === 'chunk') {
          // CHUNKING DISABLED: This code path should not be reached since
          // client has CHUNK_DETECTION_ENABLED = false. If somehow a chunk
          // message arrives, just log and ignore it.
          // The previous implementation had untracked async IIFEs that caused
          // worker hangs (wall time 100+ seconds with only 10ms CPU time).
          // See: agent-logs/2025-12-12 investigation
          console.log(JSON.stringify({
            event: 'chunk.ignored',
            reason: 'chunking_disabled',
            chunkIndex: parsed.chunkIndex,
            traceId: session.traceId,
          }));
        } else if (parsed.type === 'context_ocr') {
          // Handle OCR context (fire-and-forget)
          // Capture session reference before async work to prevent cross-session contamination
          const sessionForOcr = session;
          sessionForOcr.ocrPending = true;
          const imageBase64 = parsed.imageBase64;

          // Guardrails: prevent abusive payload sizes and skip when not configured
          // Base64 is ~4/3 of bytes; keep this comfortably under Worker limits.
          const MAX_OCR_IMAGE_BASE64_CHARS = 1_500_000;
          if (!imageBase64 || imageBase64.length > MAX_OCR_IMAGE_BASE64_CHARS) {
            sessionForOcr.ocrPending = false;
            logSessionOCR({
              outcome: 'rejected',
              trace_id: sessionForOcr.traceId ?? 'unknown',
            });
            return;
          }
          if (!GROQ_API_KEY) {
            sessionForOcr.ocrPending = false;
            logSessionOCR({
              outcome: 'no_api_key',
              trace_id: sessionForOcr.traceId ?? 'unknown',
            });
            return;
          }

          // Fire-and-forget OCR extraction
          c.executionCtx.waitUntil((async () => {
            try {
              const { extractOcrWords } = await import('../services/ocr/index.js');
              const startMs = Date.now();
              const result = await extractOcrWords({
                apiKey: GROQ_API_KEY,
                imageBase64,
              });
              const durationMs = Date.now() - startMs;

              sessionForOcr.ocrWords = result.words;
              sessionForOcr.ocrReceivedMs = Date.now();
              sessionForOcr.ocrPending = false;

              // Track OCR timing for consolidated logging
              ocrDurationMs = durationMs;

              logSessionOCR({
                outcome: 'success',
                duration_ms: durationMs,
                word_count: result.words.length,
                trace_id: sessionForOcr.traceId ?? 'unknown',
              });
            } catch (error) {
              sessionForOcr.ocrWords = [];
              sessionForOcr.ocrPending = false;
              logSessionOCR({
                outcome: 'error',
                trace_id: sessionForOcr.traceId ?? 'unknown',
                error_message: String(error),
              });
            }
          })());
        } else if (parsed.type === 'cancel') {
          session = createEmptySession();
          session.canceled = true;
          sessionActive = false;
          try { sttAbort?.abort(); } catch (error) {
            connLog.error('[WS] abort failed', { error: String(error) });
          }
        }
      } else if (data instanceof ArrayBuffer) {
        const buf = new Uint8Array(data);
        if (buf.byteLength < 16) return;
        const { seq, nbytes } = parseFrameHeader(buf);
        if (16 + nbytes > buf.byteLength) return;
        const payload = buf.subarray(16, 16 + nbytes);

        const now = Date.now();
        if (session.firstArrivalMs === null) session.firstArrivalMs = now;
        session.lastArrivalMs = now;

        if (session.lastSeq !== null && seq !== session.lastSeq + 1) {
          session.seqGaps += 1;
        }
        session.lastSeq = seq;

        const MAX_BYTES = 20 * 1024 * 1024;
        if (session.totalBytes + payload.byteLength > MAX_BYTES) {
          server.send(JSON.stringify({ type: 'error', code: 4003, body: 'audio too large', retryable: false }));
          safeClose(server, 1009, 'payload too large');
          session = createEmptySession();
          return;
        }
        session.chunks.push(payload);
        session.totalBytes += payload.byteLength;
        session.frames += 1;
      }
    } catch (e: any) {
      connLog.error('[WS] message error', { error: String(e) });
      safely(() => {
        server.send(JSON.stringify({ type: 'error', code: 9999, body: e?.message || 'ws error', retryable: false }));
        safeClose(server, 1011, 'message processing error');
      });
      session = createEmptySession();
    }
  });

  server.addEventListener('close', (evt) => {
    const code = (evt as any)?.code || 1000;
    const reason = (evt as any)?.reason || 'unknown';
    socketClosed = true;
    if (!completionLogged && !finalSent) {
      const workerLifetimeMs = wsAcceptAt ? Date.now() - wsAcceptAt : 0;
      const firstFrameLatencyMs = wsAcceptAt && session.firstArrivalMs
        ? session.firstArrivalMs - wsAcceptAt
        : null;
      const audioStreamingMs = session.firstArrivalMs && session.lastArrivalMs
        ? session.lastArrivalMs - session.firstArrivalMs
        : null;
      const totalProcessingMs = sttDurationMs + llmDurationMs;
      const overheadMs = Math.max(0, workerLifetimeMs - authDurationMs - ocrDurationMs - totalProcessingMs);
      trackSessionCompletion({
        outcome: 'client_disconnect',
        mode: session.mode,
        worker_lifetime_ms: workerLifetimeMs,
        auth_ms: authDurationMs,
        ocr_ms: ocrDurationMs,
        first_frame_latency_ms: firstFrameLatencyMs,
        audio_streaming_ms: audioStreamingMs,
        assemble_ms: 0,
        stt_ms: sttDurationMs,
        llm_ms: llmDurationMs,
        total_processing_ms: totalProcessingMs,
        overhead_ms: overheadMs,
        trace_id: session.traceId ?? traceId,
        user_id: authenticatedUserId ?? undefined,
      });
      completionLogged = true;
    }
    if (authTimeoutHandle) {
      clearTimeout(authTimeoutHandle);
      authTimeoutHandle = null;
    }
    safely(() => sttAbort?.abort());
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    releaseConnection(clientIP);
    safeClose(server, (evt as any)?.code || 1000, (evt as any)?.reason || 'client closed');
  });

  server.addEventListener('error', (evt) => {
    connLog.error('[WS] socket error', { error: String(evt) });
    socketClosed = true;
    if (authTimeoutHandle) {
      clearTimeout(authTimeoutHandle);
      authTimeoutHandle = null;
    }
    safely(() => sttAbort?.abort());
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    releaseConnection(clientIP);
    safeClose(server, 1011, 'socket error');
  });

  return new Response(null, { status: 101, webSocket: client });
}
