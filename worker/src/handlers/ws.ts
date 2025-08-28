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
import { DEFAULT_LLM_SYSTEM_PROMPT } from '../services/llm/prompt';

type Bindings = {
  GROQ_API_KEY?: string;
  ENABLE_LLM?: string; // '1' | 'true' to enable
  LLM_STREAM?: string; // '1' | 'true' to stream deltas
  LLM_MODEL?: string; // default gpt-oss-20b
  LLM_REASONING?: string; // low|medium|high
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

  const connLog = createLogger({ ip: clientIP }).with({ traceId: session.traceId });

  server.accept();
  connLog.info('[WS] accepted');

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
        } else if (parsed.type === 'end') {
          const t0 = Date.now();
          session.processingStartAt = t0;
          if (!socketClosed) {
            try {
              server.send(
                JSON.stringify({
                  type: 'status',
                  state: 'processing',
                  traceId: session.traceId,
                  serverTs: Date.now(),
                }),
              );
            } catch (error) {
              connLog.error('[WS] status send failed', { error: String(error) });
            }
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
                sttAbort?.abort();
                sttAbort = new AbortController();
                const res = await transcribeWav(wav, GROQ_API_KEY, { signal: sttAbort.signal });
                finalText = res.text;
                timings = res.timings;
                
                // Optional LLM post-process
                const enableLLM = (c.env.ENABLE_LLM ?? '1').toLowerCase() === '1' || (c.env.ENABLE_LLM ?? 'true').toLowerCase() === 'true';
                if (enableLLM && finalText) {
                  // Notify client that LLM processing starts
                  try {
                    server.send(
                      JSON.stringify({
                        type: 'llm_status',
                        state: 'llm_processing',
                        traceId: session.traceId,
                        serverTs: Date.now(),
                      }),
                    );
                  } catch {}

                  const streamLLM = (c.env.LLM_STREAM ?? '1').toLowerCase() === '1' || (c.env.LLM_STREAM ?? 'true').toLowerCase() === 'true';
                  const model = c.env.LLM_MODEL || 'openai/gpt-oss-120b';
                  const reasoning = ((c.env.LLM_REASONING || 'medium').toLowerCase() as 'low' | 'medium' | 'high');

                  const llmRes = await chatComplete({
                    apiKey: GROQ_API_KEY,
                    model,
                    reasoningEffort: reasoning,
                    systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT,
                    userContent: finalText,
                    stream: streamLLM,
                    signal: sttAbort.signal,
                    onDelta: (delta) => {
                      if (!socketClosed && streamLLM && delta) {
                        try {
                          server.send(
                            JSON.stringify({ type: 'llm_delta', delta, traceId: session.traceId }),
                          );
                        } catch {}
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
            try { sttAbort?.abort(); } catch {}
            if (!socketClosed) {
              try {
                server.send(JSON.stringify({ type: 'error', body: e?.message || 'Transcription error' }));
              } catch (sendError) {
                connLog.error('[WS] error send failed', { error: String(sendError) });
              }
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
          // Use regular logger for now - Sentry context logger is within the span
          logSession(connLog.info, 'final', session, {
            assembleMs,
            stt: { ttfbMs: sttTtfbMs, bodyMs: sttBodyMs, totalMs: sttTotalMs },
            llm: { ttfbMs: llmTtfbMs, bodyMs: llmBodyMs, totalMs: llmTotalMs },
            finalizationMs,
            overheadMs,
            textLen: (llmText || finalText).length,
          });
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
      try {
        server.send(JSON.stringify({ type: 'error', body: e?.message || 'ws error' }));
        safeClose(server, 1011, 'message processing error');
      } catch {}
      session = createEmptySession();
    }
  });

  server.addEventListener('close', (evt) => {
    logSession(connLog.info, 'ws_close', session, {
      code: (evt as any)?.code || 'unknown',
      reason: (evt as any)?.reason || 'unknown',
    });
    socketClosed = true;
    try { sttAbort?.abort(); } catch {}
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    releaseConnection(clientIP);
    safeClose(server, (evt as any)?.code || 1000, (evt as any)?.reason || 'client closed');
  });

  server.addEventListener('error', (evt) => {
    connLog.error('[WS] socket error', { error: String(evt) });
    socketClosed = true;
    try { sttAbort?.abort(); } catch {}
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    releaseConnection(clientIP);
    safeClose(server, 1011, 'socket error');
  });

  return new Response(null, { status: 101, webSocket: client });
}
