import type { Context } from 'hono';
import { parseClientMessage } from '../types/messages';
import { getClientIP } from '../utils/ip';
import { trackConnection, releaseConnection } from '../utils/connLimit';
import { createLogger } from '../utils/logger';
import { safeClose, safeJson } from '../utils/ws';
import { concat, parseFrameHeader, wrapWav } from '../audio/codec';
import { createEmptySession, logSession } from '../ws/session';
import { transcribeWav } from '../services/stt/groq';

type Bindings = { GROQ_API_KEY?: string };

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
          try {
            if (GROQ_API_KEY) {
              sttAbort?.abort();
              sttAbort = new AbortController();
              const res = await transcribeWav(wav, GROQ_API_KEY, { signal: sttAbort.signal });
              finalText = res.text;
              timings = res.timings;
            } else {
              finalText = '';
            }
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
                finalSentAt: Date.now(),
              };
              server.send(
                JSON.stringify({
                  type: 'final',
                  text: finalText,
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
          const finalizationMs = t1 - t0;
          const overheadMs =
            sttTotalMs != null
              ? Math.max(0, finalizationMs - assembleMs - sttTotalMs)
              : Math.max(0, finalizationMs - assembleMs);
          logSession(connLog.info, 'final', session, {
            assembleMs,
            stt: { ttfbMs: sttTtfbMs, bodyMs: sttBodyMs, totalMs: sttTotalMs },
            finalizationMs,
            overheadMs,
            textLen: finalText.length,
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

