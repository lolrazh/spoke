import type { Context } from 'hono';
import * as Sentry from '@sentry/cloudflare';
import { parseClientMessage } from '../types/messages';
import { getClientIP } from '../utils/ip';
import { trackConnection, releaseConnection } from '../utils/connLimit';
import { createLogger } from '../utils/logger';
import { safeClose, safeJson } from '../utils/ws';
import { concat, parseFrameHeader, wrapWav } from '../audio/codec';
import { createEmptySession, logSession } from '../ws/session';
import { transcribeWav } from '../services/stt';
import { chatCompleteByProvider } from '../services/llm';
import { selectLLMRoute } from '../services/llm/routing';
import { buildLLMSystemPrompt } from '../services/llm/prompt';
import { prepareEditRequest, buildEditSystemPrompt } from '../services/llm/editPrompt';
import { buildSTTPrompt } from '../services/stt/prompt';
import { getRuntimeConfig } from '../config/runtime';
import { safely } from '../utils/safely';
import {
  GROQ_STT_ENDPOINT,
  FIREWORKS_STT_TURBO_ENDPOINT,
  DEEPGRAM_STT_ENDPOINT,
  GROQ_LLM_ENDPOINT,
  OPENAI_LLM_ENDPOINT,
  BASETEN_LLM_ENDPOINT,
  OPENROUTER_LLM_ENDPOINT,
} from '../config';

type Bindings = {
  GROQ_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BASETEN_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ENABLE_LLM?: string; // '1' | 'true' to enable
  LLM_STREAM?: string; // '1' | 'true' to stream deltas
  LLM_MODEL?: string; // default from src/config.ts
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

  const { GROQ_API_KEY, FIREWORKS_API_KEY, DEEPGRAM_API_KEY, OPENROUTER_API_KEY } = c.env;
  const [client, server] = Object.values(new WebSocketPair());

  let session = createEmptySession();
  session.wsAcceptAt = Date.now();
  let socketClosed = false;
  let sttAbort: AbortController | null = null;
  let sessionActive = false;
  let finalSent = false;

  const connLog = createLogger({ ip: clientIP }).with({ traceId: session.traceId });

  server.accept();
  // Accept silently; avoid emitting ws.accepted logs to Sentry to reduce noise

  // Track optional language from client
  let clientLanguage: string | undefined = undefined;

  server.addEventListener('message', async (evt: MessageEvent) => {
    try {
      const data = evt.data;
      if (typeof data === 'string') {
        const msg = safeJson(data);
        const parsed = parseClientMessage(msg);
        if (!parsed) return;
        if (parsed.type === 'start') {
          if (sessionActive) {
            connLog.warn('[WS] duplicate start ignored');
            return;
          }
          sessionActive = true;
          session = createEmptySession();
          session.startedAt = Date.now();
          session.version = parsed.version ?? 1;
          session.format = parsed.format ?? 'pcm16le';
          session.rate = parsed.rate ?? 16000;
          session.traceId = parsed.traceId;
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

          if (session.canceled || session.totalBytes === 0) {
            const text = '';
            server.send(JSON.stringify({ type: 'final', text }));
            safeClose(server, 1000, 'done');
            session = createEmptySession();
            sessionActive = false;
            return;
          }

          const assembleStart = Date.now();
          const pcm = concat(session.chunks, session.totalBytes);
          const wav = wrapWav(pcm, session.rate, 1, 16);
          const assembleMs = Date.now() - assembleStart;

          let finalText = '';
          let timings: { startAt: number; headersAt: number; bodyDoneAt: number } | null = null;
          let llmText = '';
          let llmTimings: { startAt: number; headersAt: number; firstDeltaAt?: number; bodyDoneAt: number } | null = null;
          let llmSuccess = false;
          let llmProvider: string | null = null;
          let llmModel: string | null = null;
          let llmRouteRules: string[] = [];

          const runtime = getRuntimeConfig(c.env);
          const sttProvider = runtime.stt.provider;

          try {
            await Sentry.startSpan({
              op: 'transcription.session',
              name: `Audio Transcription Session ${session.traceId}`,
              attributes: {
                'session.trace_id': session.traceId,
                'client.ip': clientIP,
                'audio.frames': session.frames,
                'audio.total_bytes': session.totalBytes,
                'audio.bytes_kb': Number((session.totalBytes / 1024).toFixed(2)),
                'audio.sample_rate': session.rate,
                'audio.format': session.format,
                'audio.seq_gaps': session.seqGaps,
                'audio.first_to_last_arrival_ms': 
                  session.firstArrivalMs && session.lastArrivalMs
                    ? session.lastArrivalMs - session.firstArrivalMs
                    : null,
                'processing.assemble_ms': assembleMs,
              },
            }, async (sessionSpan) => {
              // Add session context directly to the span using setAttribute
              sessionSpan.setAttribute('session.worker_trace_id', session.traceId);
              sessionSpan.setAttribute('dataset.allowed', session.shareTranscriptions ? 1 : 0);
              
              const sttApiKey =
                sttProvider === 'fireworks'
                  ? FIREWORKS_API_KEY
                  : sttProvider === 'deepgram'
                    ? DEEPGRAM_API_KEY
                    : GROQ_API_KEY;
              const sttEndpoint =
                sttProvider === 'fireworks'
                  ? FIREWORKS_STT_TURBO_ENDPOINT
                  : sttProvider === 'deepgram'
                    ? DEEPGRAM_STT_ENDPOINT
                    : GROQ_STT_ENDPOINT;

              sessionSpan.setAttribute('stt.provider', sttProvider);

              if (sttApiKey) {
                sttAbort?.abort();
                sttAbort = new AbortController();
                const sttPrompt = buildSTTPrompt({
                  basePrompt: runtime.stt.prompt,
                  identity: session.identity,
                });
                // Log STT request details (console only)
                try {
                  const sttLog = {
                    event: 'stt.request',
                    provider: sttProvider,
                    model: runtime.stt.model,
                    endpoint: sttEndpoint,
                    language: clientLanguage || runtime.stt.language,
                    timeoutMs: runtime.stt.timeoutMs,
                    audioSizeKB: Number((wav.length / 1024).toFixed(2)),
                    traceId: session.traceId,
                  } as const;
                  console.log(JSON.stringify(sttLog));
                } catch {}
                const sttStartTime = Date.now();
                const res = await transcribeWav(wav, {
                  provider: sttProvider,
                  apiKey: sttApiKey,
                  signal: sttAbort.signal,
                  model: runtime.stt.model,
                  language: clientLanguage || runtime.stt.language,
                  prompt: sttPrompt,
                  timeoutMs: runtime.stt.timeoutMs,
                });
                const sttDuration = Date.now() - sttStartTime;
                finalText = res.text;
                // Log STT completion
                try {
                  const sttCompleteLog = {
                    event: 'stt.complete',
                    provider: sttProvider,
                    durationMs: sttDuration,
                    textLength: finalText.length,
                    traceId: session.traceId,
                  } as const;
                  console.log(JSON.stringify(sttCompleteLog));
                } catch {}
                timings = res.timings;

                const editPlan =
                  session.mode === 'edit' && runtime.edit.enabled
                    ? prepareEditRequest({
                        instructions: finalText,
                        selection: session.selection,
                      })
                    : null;
                if (sessionSpan) {
                  sessionSpan.setAttribute('session.mode', session.mode ?? 'dictation');
                  sessionSpan.setAttribute('edit.enabled', runtime.edit.enabled);
                  sessionSpan.setAttribute('edit.provider', runtime.edit.provider);
                  if (editPlan) {
                    sessionSpan.setAttribute('edit.instructions_length', editPlan.instructions.length);
                    sessionSpan.setAttribute('edit.selection_length', editPlan.originalText.length);
                    sessionSpan.setAttribute('edit.prompt_length', editPlan.prompt.length);
                  if (typeof editPlan.hadSelection === 'boolean') {
                    sessionSpan.setAttribute('edit.had_selection', editPlan.hadSelection);
                  }
                  if (session.selection?.source) {
                    sessionSpan.setAttribute('edit.selection_source', session.selection.source);
                  }
                }
              }

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

                  const provider = runtime.edit.provider;
                  llmProvider = provider;
                  const model = runtime.edit.model;
                  llmModel = model;
                  const apiKeyForProvider =
                    provider === 'openai'
                      ? c.env.OPENAI_API_KEY
                      : provider === 'baseten'
                        ? c.env.BASETEN_API_KEY
                        : provider === 'openrouter'
                          ? OPENROUTER_API_KEY
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
                    } catch {}
                    const editStartTime = Date.now();
                    try {
                      const streamEdit = runtime.edit.stream;
                      const editRes = await chatCompleteByProvider(provider, {
                        apiKey: apiKeyForProvider,
                        model,
                        systemPrompt: buildEditSystemPrompt(),
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
                      } catch {}
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
                      } catch {}
                      sessionSpan.setAttribute('edit.error', String(error));
                      llmText = editPlan.originalText;
                    }
                  } else {
                    sessionSpan.setAttribute('edit.api_key_missing', true);
                    llmText = editPlan.originalText;
                  }
                } else if (enableLLM && finalText) {
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

                  const streamLLM = runtime.llm.stream;
                  const routeDecision = selectLLMRoute(finalText, runtime.llm);
                  const provider = routeDecision.provider;
                  const model = routeDecision.model;
                  llmProvider = provider;
                  llmModel = model;
                  llmRouteRules = routeDecision.matchedRuleIds;
                  const apiKeyForProvider =
                    provider === 'openai'
                      ? c.env.OPENAI_API_KEY
                      : provider === 'baseten'
                        ? c.env.BASETEN_API_KEY
                        : provider === 'openrouter'
                          ? OPENROUTER_API_KEY
                        : GROQ_API_KEY;

                  if (apiKeyForProvider) {
                    // Log LLM request details (console only)
                    try {
                      const llmEndpoint =
                        provider === 'openai'
                          ? OPENAI_LLM_ENDPOINT
                          : provider === 'baseten'
                            ? BASETEN_LLM_ENDPOINT
                            : provider === 'openrouter'
                              ? OPENROUTER_LLM_ENDPOINT
                            : GROQ_LLM_ENDPOINT;
                      const llmLog = {
                        event: 'llm.request',
                        provider,
                        model,
                        endpoint: llmEndpoint,
                        stream: streamLLM,
                        timeoutMs: runtime.llm.timeoutMs,
                        routeRules: llmRouteRules.length ? llmRouteRules : undefined,
                        traceId: session.traceId,
                      } as const;
                      console.log(JSON.stringify(llmLog));
                    } catch {}
                    const llmStartTime = Date.now();
                    const llmRes = await chatCompleteByProvider(provider, {
                      apiKey: apiKeyForProvider,
                      model,
                      systemPrompt: buildLLMSystemPrompt({ model, currentDate: runtime.llm.currentDate, sttPrompt }),
                      userContent: finalText,
                      stream: streamLLM,
                      temperature: runtime.llm.temperature,
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
                    // Log LLM completion
                    try {
                      const llmCompleteLog = {
                        event: 'llm.complete',
                        provider,
                        durationMs: llmDuration,
                        textLength: llmText.length,
                        success: llmSuccess,
                        traceId: session.traceId,
                      } as const;
                      console.log(JSON.stringify(llmCompleteLog));
                    } catch {}
                  } else {
                    sessionSpan.setAttribute('llm.api_key_missing', true);
                  }
                }
                
                // Set final session attributes with all timing data
                sessionSpan.setAttribute('stt.text_length', finalText.length);
                sessionSpan.setAttribute('stt.success', true);
                if (timings) {
                  sessionSpan.setAttribute('stt.ttfb_ms', timings.headersAt - timings.startAt);
                  sessionSpan.setAttribute('stt.body_ms', timings.bodyDoneAt - timings.headersAt);
                  sessionSpan.setAttribute('stt.total_ms', timings.bodyDoneAt - timings.startAt);
                }

                sessionSpan.setAttribute('llm.provider', llmProvider ?? runtime.llm.provider);
                sessionSpan.setAttribute('llm.model', llmModel ?? runtime.llm.model);
                if (llmRouteRules.length > 0) {
                  sessionSpan.setAttribute('llm.route_rules', llmRouteRules.join(','));
                }

                if (llmText) {
                  sessionSpan.setAttribute('llm.text_length', llmText.length);
                  sessionSpan.setAttribute('llm.enabled', true);
                  sessionSpan.setAttribute('llm.success', llmSuccess);
                  if (llmTimings) {
                    const llmTtfb = (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt;
                    sessionSpan.setAttribute('llm.ttfb_ms', llmTtfb);
                    sessionSpan.setAttribute('llm.body_ms', llmTimings.bodyDoneAt - (llmTimings.firstDeltaAt ?? llmTimings.headersAt));
                    sessionSpan.setAttribute('llm.total_ms', llmTimings.bodyDoneAt - llmTimings.startAt);
                    if (llmTimings.firstDeltaAt)
                      sessionSpan.setAttribute('llm.first_token_ms', llmTimings.firstDeltaAt - llmTimings.startAt);
                  }
                } else {
                  sessionSpan.setAttribute('llm.enabled', enableLLM);
                  sessionSpan.setAttribute('llm.success', false);
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
                      } catch {}
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
                      } catch {}
                    }
                  } catch {}
                }
                if (session.shareTranscriptions) {
                  sessionSpan.setAttribute('session.final_text', llmText || finalText);
                }
                sessionSpan.setAttribute('session.final_text_length', (llmText || finalText).length);
              } else {
                finalText = '';
                sessionSpan.setAttribute('stt.api_key_missing', true);
                sessionSpan.setAttribute('stt.provider', sttProvider);
                connLog.error('[WS] missing STT API key', { provider: sttProvider });
              }
            });
          } catch (e: any) {
            safely(() => sttAbort?.abort());
            const errorMsg = String(e?.message || e || '');
            const isAbortError = e?.name === 'AbortError' || errorMsg.includes('abort');
            const isExpectedAbort = isAbortError && (session.canceled || socketClosed);

            // Determine which stage failed based on whether we got STT results
            const failedStage = finalText ? 'llm' : 'stt';

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
              } catch {}
            }

            if (!socketClosed) {
              // Determine error code based on error type
              let errorCode = 4001; // STT_API_ERROR default
              if (errorMsg.includes('timeout') || errorMsg.includes('timed out') || isAbortError) {
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
            session = createEmptySession();
            sessionActive = false;
            return;
          }

          if (!socketClosed) {
            try {
              const workerMetrics = {
                traceId: session.traceId,
                wsAcceptAt: session.wsAcceptAt ?? null,
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
                llm: llmTimings
                  ? {
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
                    }
                  : null,
                finalSentAt: Date.now(),
              };
              server.send(
                JSON.stringify({
                  type: 'final',
                  text: llmText || finalText,
                  traceId: session.traceId,
                  // Pass dataset texts so the client can forward to /metrics/session
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

          const t1 = Date.now();
          const sttTtfbMs = timings ? timings.headersAt - timings.startAt : null;
          const sttBodyMs = timings ? timings.bodyDoneAt - timings.headersAt : null;
          const sttTotalMs = timings ? timings.bodyDoneAt - timings.startAt : null;
          const llmTtfbMs = llmTimings ? (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt : null;
          const llmBodyMs = llmTimings ? llmTimings.bodyDoneAt - (llmTimings.firstDeltaAt ?? llmTimings.headersAt) : null;
          const llmTotalMs = llmTimings ? llmTimings.bodyDoneAt - llmTimings.startAt : null;
          const llmFirstTokenMs =
            llmTimings?.firstDeltaAt != null && llmTimings?.startAt != null
              ? llmTimings.firstDeltaAt - llmTimings.startAt
              : llmTtfbMs;
          const finalizationMs = t1 - t0;
          const overheadMs =
            sttTotalMs != null
              ? Math.max(0, finalizationMs - assembleMs - sttTotalMs - (llmTotalMs ?? 0))
              : Math.max(0, finalizationMs - assembleMs);
          // Compose a single session_summary (server-only) and attach to Sentry logs/span
          try {
            const wsAccept = session.wsAcceptAt ?? null;
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
                sttTtfbMs,
                sttBodyMs,
                llmMs: llmTotalMs,
                llmTtfbMs,
                llmBodyMs,
                llmFirstTokenMs,
                serverProcessingMs: (sttTotalMs ?? 0) + (llmTotalMs ?? 0),
                overheadMs,
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
              llm: llmProvider
                ? {
                    provider: llmProvider,
                    model: llmModel,
                    routeRules: llmRouteRules.length ? llmRouteRules : null,
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
            // Log as single-line JSON (captured by Sentry console integration)
            safely(() => console.log(JSON.stringify(summary)));
            // Enrich the Sentry span (we are still inside the span callback)
            await Sentry.startSpan({
              op: 'transcription.session_summary',
              name: `Session Summary ${session.traceId ?? ''}`,
              attributes: { 'session.trace_id': session.traceId ?? '' },
            }, async (span) => {
              span.setAttribute('pipeline', pipeline);
              span.setAttribute('dur.wsAcceptToFinalMs', wsAcceptToFinalMs ?? 0);
              span.setAttribute('dur.assembleMs', assembleMs);
              if (sttTotalMs != null) span.setAttribute('dur.sttMs', sttTotalMs);
              if (sttTtfbMs != null) span.setAttribute('dur.sttTtfbMs', sttTtfbMs);
              if (sttBodyMs != null) span.setAttribute('dur.sttBodyMs', sttBodyMs);
              if (llmTotalMs != null) span.setAttribute('dur.llmMs', llmTotalMs);
              if (llmTtfbMs != null) span.setAttribute('dur.llmTtfbMs', llmTtfbMs);
              if (llmBodyMs != null) span.setAttribute('dur.llmBodyMs', llmBodyMs);
              if (llmFirstTokenMs != null) span.setAttribute('dur.llmFirstTokenMs', llmFirstTokenMs);
              span.setAttribute('dur.serverProcessingMs', (sttTotalMs ?? 0) + (llmTotalMs ?? 0));
              span.setAttribute('dur.overheadMs', overheadMs);
              span.setAttribute('traffic.frames', session.frames);
              span.setAttribute('traffic.bytesKB', Number((session.totalBytes / 1024).toFixed(2)));
              span.setAttribute('traffic.seqGaps', session.seqGaps);
              span.setAttribute('result.text_len', (llmText || finalText).length);
              if (session.mode === 'edit') {
                span.setAttribute('edit.instructions_len', finalText.length);
                span.setAttribute('edit.output_len', (llmText || '').length);
              }
            });
          } catch (err) {
            connLog.error('[WS] session summary failed', { error: String(err) });
          }
          finalSent = true;
          session = createEmptySession();
          sessionActive = false;
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
    // Only log ws_close when abnormal or no final was sent (to reduce noise)
    // Reduce noise: no Sentry logs for closes; rely on session_summary for observability
    socketClosed = true;
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
    safely(() => sttAbort?.abort());
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    releaseConnection(clientIP);
    safeClose(server, 1011, 'socket error');
  });

  return new Response(null, { status: 101, webSocket: client });
}
