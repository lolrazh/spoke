import type { Context } from 'hono';
import * as Sentry from '@sentry/cloudflare';
import { parseClientMessage } from '../types/messages';
import { getClientIP } from '../utils/ip';
import { trackConnection, releaseConnection } from '../utils/connLimit';
import { createLogger } from '../utils/logger';
import { safeClose, safeJson } from '../utils/ws';
import { concat, parseFrameHeader, wrapWav } from '../audio/codec';
import { createEmptySession, logSession } from '../ws/session';
import { transcribeWav } from '../services/stt/groq';
import { chatComplete } from '../services/llm/groq';
import { buildLLMSystemPrompt } from '../services/llm/prompt';
import { buildSTTPrompt } from '../services/stt/prompt';
import { getRuntimeConfig } from '../config/runtime';
import { safely } from '../utils/safely';

type Bindings = {
  GROQ_API_KEY?: string;
  ENABLE_LLM?: string; // '1' | 'true' to enable
  LLM_STREAM?: string; // '1' | 'true' to stream deltas
  LLM_MODEL?: string; // default from src/config.ts
};

export function wsRoute(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('Expected a websocket connection', 426);
  }

  const logger = createLogger();
  const clientIP = getClientIP(c.req.raw);
  if (!trackConnection(clientIP)) {
    return c.text('Too many connections from your IP. Please try again later.', 429);
  }

  const { GROQ_API_KEY } = c.env;
  const [client, server] = Object.values(new WebSocketPair());

  let session = createEmptySession();
  session.wsAcceptAt = Date.now();
  let socketClosed = false;
  let sttAbort: AbortController | null = null;
  let sessionActive = false;
  let finalSent = false;

  const connLog = createLogger({ ip: clientIP }).with({ traceId: session.traceId });

  server.accept();
  connLog.info('[WS] accepted');
  safely(() => Sentry.logger.info('ws.accepted', { ip: clientIP }));

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
          safely(() => Sentry.logger.info('session.start', { 'session.trace_id': session.traceId }));
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
              
              if (GROQ_API_KEY) {
                const runtime = getRuntimeConfig(c.env);
                sttAbort?.abort();
                sttAbort = new AbortController();
                const res = await transcribeWav(wav, GROQ_API_KEY, {
                  signal: sttAbort.signal,
                  model: runtime.stt.model,
                  language: clientLanguage || runtime.stt.language,
                  prompt: runtime.stt.prompt || buildSTTPrompt(),
                  timeoutMs: runtime.stt.timeoutMs,
                });
                finalText = res.text;
                timings = res.timings;
                
                // Optional LLM post-process
                const enableLLM = runtime.llm.enabled;
                if (enableLLM && finalText) {
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
                  const model = runtime.llm.model;

                  const llmRes = await chatComplete({
                    apiKey: GROQ_API_KEY,
                    model,
                    systemPrompt: buildLLMSystemPrompt({ model, currentDate: runtime.llm.currentDate }),
                    userContent: finalText,
                    stream: streamLLM,
                    signal: sttAbort.signal,
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
                  llmText = llmRes.text || '';
                  llmTimings = llmRes.timings;
                }
                
                // Set final session attributes with all timing data  
                sessionSpan.setAttribute('stt.text_length', finalText.length);
                sessionSpan.setAttribute('stt.success', true);
                if (timings) {
                  sessionSpan.setAttribute('stt.ttfb_ms', timings.headersAt - timings.startAt);
                  sessionSpan.setAttribute('stt.body_ms', timings.bodyDoneAt - timings.headersAt);
                  sessionSpan.setAttribute('stt.total_ms', timings.bodyDoneAt - timings.startAt);
                }
                
                if (llmText) {
                  sessionSpan.setAttribute('llm.text_length', llmText.length);
                  sessionSpan.setAttribute('llm.enabled', true);
                  sessionSpan.setAttribute('llm.success', true);
                  if (llmTimings) {
                    sessionSpan.setAttribute('llm.ttfb_ms', (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt);
                    sessionSpan.setAttribute('llm.body_ms', llmTimings.bodyDoneAt - (llmTimings.firstDeltaAt ?? llmTimings.headersAt));
                    sessionSpan.setAttribute('llm.total_ms', llmTimings.bodyDoneAt - llmTimings.startAt);
                  }
                } else {
                  sessionSpan.setAttribute('llm.enabled', enableLLM);
                }
                
                // Add overall session timing
                const finalizationMs = Date.now() - t0;
                const overheadMs = Math.max(0, finalizationMs - assembleMs - (timings ? (timings.bodyDoneAt - timings.startAt) : 0) - (llmTimings ? (llmTimings.bodyDoneAt - llmTimings.startAt) : 0));
                sessionSpan.setAttribute('session.finalization_ms', finalizationMs);
                sessionSpan.setAttribute('session.overhead_ms', overheadMs);
                sessionSpan.setAttribute('session.final_text', llmText || finalText);
                sessionSpan.setAttribute('session.final_text_length', (llmText || finalText).length);
              } else {
                finalText = '';
                sessionSpan.setAttribute('groq.api_key_missing', true);
              }
            });
          } catch (e: any) {
            safely(() => sttAbort?.abort());
            if (!socketClosed) {
              const ok = safely(() => server.send(
                JSON.stringify({ type: 'error', body: e?.message || 'Transcription error' })
              ));
              if (!ok) connLog.error('[WS] error send failed');
              safeClose(server, 1011, 'stt error');
            }
            connLog.error('[WS] Transcription error', { error: String(e) });
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
                groq: timings
                  ? {
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
                      startAt: llmTimings.startAt,
                      headersAt: llmTimings.headersAt,
                      firstDeltaAt: llmTimings.firstDeltaAt ?? null,
                      bodyDoneAt: llmTimings.bodyDoneAt,
                      ttfbMs: (llmTimings.firstDeltaAt ?? llmTimings.headersAt) - llmTimings.startAt,
                      bodyMs: llmTimings.bodyDoneAt - (llmTimings.firstDeltaAt ?? llmTimings.headersAt),
                      totalMs: llmTimings.bodyDoneAt - llmTimings.startAt,
                    }
                  : null,
                finalSentAt: Date.now(),
              };
              server.send(
                JSON.stringify({
                  type: 'final',
                  text: llmText || finalText,
                  traceId: session.traceId,
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
          const finalizationMs = t1 - t0;
          const overheadMs =
            sttTotalMs != null
              ? Math.max(0, finalizationMs - assembleMs - sttTotalMs - (llmTotalMs ?? 0))
              : Math.max(0, finalizationMs - assembleMs);
          // Compose a single session_summary (server-only) and attach to Sentry logs/span
          try {
            const wsAccept = session.wsAcceptAt ?? null;
            const wsAcceptToFinalMs = wsAccept ? t1 - wsAccept : null;
            const pipeline = llmTotalMs != null ? 'stt+llm' : 'stt';
            const summary = {
              event: 'transcription.session_summary',
              id: session.traceId ?? null,
              pipeline,
              durations: {
                wsAcceptToFinalMs,
                assembleMs,
                sttMs: sttTotalMs,
                llmMs: llmTotalMs,
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
              ws: { closeCode: 1000, closeReason: 'done' },
              env: {},
              containsClientMetrics: false,
            } as const;
            // Log as single-line JSON
            safely(() => console.log(JSON.stringify(summary)));
            // Also send to Sentry logs for Logs product and enrich span
            safely(() => {
              Sentry.logger.info('session.summary', { 'session.trace_id': session.traceId ?? '', ...summary });
            });
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
              if (llmTotalMs != null) span.setAttribute('dur.llmMs', llmTotalMs);
              span.setAttribute('dur.serverProcessingMs', (sttTotalMs ?? 0) + (llmTotalMs ?? 0));
              span.setAttribute('dur.overheadMs', overheadMs);
              span.setAttribute('traffic.frames', session.frames);
              span.setAttribute('traffic.bytesKB', Number((session.totalBytes / 1024).toFixed(2)));
              span.setAttribute('traffic.seqGaps', session.seqGaps);
              span.setAttribute('result.text_len', (llmText || finalText).length);
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
          server.send(JSON.stringify({ type: 'error', body: 'audio too large' }));
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
        server.send(JSON.stringify({ type: 'error', body: e?.message || 'ws error' }));
        safeClose(server, 1011, 'message processing error');
      });
      session = createEmptySession();
    }
  });

  server.addEventListener('close', (evt) => {
    const code = (evt as any)?.code || 1000;
    const reason = (evt as any)?.reason || 'unknown';
    // Only log ws_close when abnormal or no final was sent (to reduce noise)
    if (!finalSent || code !== 1000) {
      logSession(connLog.info, 'ws_close', session, {
        code,
        reason,
      });
      safely(() => Sentry.logger.warn('session.ws_close', { 'session.trace_id': session.traceId ?? '', code, reason }));
    }
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
