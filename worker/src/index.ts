import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as Sentry from '@sentry/cloudflare';
import { wsRoute } from './handlers/ws';

type Bindings = {
  GROQ_API_KEY?: string;
  ENABLE_LLM?: string;
  LLM_STREAM?: string;
  LLM_MODEL?: string;
  LLM_REASONING?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: any;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health
app.get('/', (c) => c.text('ok'));

// WebSocket ingest: 500 ms PCM16@16k frames
app.get('/ws', wsRoute);

// CORS for metrics endpoint (dev: Vite on localhost:5173; prod: Electron file:// origin)
app.use('/metrics/*', cors({ origin: '*' }));

// Metrics ingest from client: merges client-side E2E timings into a single summary
app.post('/metrics/session', async (c) => {
  try {
    const body = await c.req.json<{
      traceId: string;
      client?: Record<string, unknown>;
      worker?: Record<string, unknown> | null;
      meta?: { appVersion?: string; platform?: string };
      derived?: Record<string, unknown>;
    }>();

    const traceId = (body?.traceId ?? '').toString();
    if (!traceId) {
      return c.json({ error: 'traceId required' }, 400);
    }

    const pipeline = ((body?.worker as any)?.llm?.totalMs ?? null) != null ? 'stt+llm' : 'stt';

    const summary = {
      event: 'transcription.session_summary',
      id: traceId,
      pipeline,
      durations: {
        e2eMs: (body?.derived as any)?.e2eMs ?? null,
        captureMs: (body?.derived as any)?.captureMs ?? null,
        deliverMs: (body?.derived as any)?.deliverMs ?? null,
        pasteMs: (body?.derived as any)?.pasteMs ?? null,
        // Server-derived placeholders if present in worker metrics
        wsAcceptToFinalMs: (body?.worker as any)?.finalSentAt && (body?.worker as any)?.wsAcceptAt
          ? ((body?.worker as any)?.finalSentAt as number) - ((body?.worker as any)?.wsAcceptAt as number)
          : null,
        assembleMs: (body?.worker as any)?.assembleMs ?? null,
        sttMs: (body?.worker as any)?.groq?.totalMs ?? (body?.worker as any)?.stt?.totalMs ?? null,
        llmMs: (body?.worker as any)?.llm?.totalMs ?? null,
        serverProcessingMs:
          ((body?.worker as any)?.groq?.totalMs ?? (body?.worker as any)?.stt?.totalMs ?? 0) +
          ((body?.worker as any)?.llm?.totalMs ?? 0),
        overheadMs: (body?.worker as any)?.overheadMs ?? null,
      },
      traffic: {
        frames: (body?.worker as any)?.frames ?? (body?.client as any)?.framesProduced ?? null,
        bytesKB: Number((((body?.worker as any)?.bytes ?? 0) / 1024).toFixed(2)) ||
          Number((((body?.client as any)?.bytesProduced ?? 0) / 1024).toFixed(2)) || 0,
        seqGaps: (body?.worker as any)?.seqGaps ?? 0,
        firstToLastArrivalMs: (body?.worker as any)?.firstToLastArrivalMs ?? null,
      },
      result: {
        textLen: (body?.worker as any)?.textLen ?? null,
      },
      ws: {
        closeCode: (body?.worker as any)?.closeCode ?? 1000,
        closeReason: (body?.worker as any)?.closeReason ?? 'done',
      },
      env: {
        environment: c.env.SENTRY_ENVIRONMENT || 'production',
        release: (c.env as any)?.CF_VERSION_METADATA?.id || 'unknown',
      },
      containsClientMetrics: true,
    } as const;

    // Log one-line JSON summary
    try {
      console.log(JSON.stringify(summary));
    } catch {}

    // Also record to Sentry for correlation
    await Sentry.startSpan({
      op: 'transcription.session_summary',
      name: `Session Summary ${traceId}`,
      attributes: { 'session.trace_id': traceId },
    }, async (span) => {
      // Flatten some key attributes for searchability
      span.setAttribute('pipeline', summary.pipeline);
      for (const [k, v] of Object.entries(summary.durations)) span.setAttribute(`dur.${k}`, v as any);
      for (const [k, v] of Object.entries(summary.traffic)) span.setAttribute(`traffic.${k}`, v as any);
      span.setAttribute('result.text_len', summary.result.textLen ?? 0);
      span.setAttribute('ws.code', summary.ws.closeCode);
      span.setAttribute('ws.reason', summary.ws.closeReason);
    });

    return c.body(null, 204);
  } catch (e: any) {
    return c.json({ error: 'invalid payload', detail: String(e) }, 400);
  }
});

// Simple test endpoint to verify Sentry Logs ingestion
app.get('/logs/test', (c) => {
  try {
    Sentry.logger.info('User triggered test log', { action: 'test_log', route: '/logs/test' });
  } catch {}
  return c.json({ ok: true });
});

export default Sentry.withSentry(
  (env: Bindings) => {
    const { id: versionId } = env.CF_VERSION_METADATA || { id: 'unknown' };

    return {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT || 'production',
      release: versionId,
      sendDefaultPii: true,
      tracesSampleRate: env.SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
      integrations: [
        // Connect your console logs to Sentry Logs
        Sentry.consoleLoggingIntegration({ 
          levels: ["log", "info", "warn", "error", "debug"]
        }),
      ],
      enableLogs: true,
    };
  },
  app
);
