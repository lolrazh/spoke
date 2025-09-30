import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as Sentry from '@sentry/cloudflare';
import { wsRoute } from './handlers/ws';
import { safely } from './utils/safely';
import { buildSessionSummary } from './utils/summary';

type Bindings = {
  GROQ_API_KEY?: string;
  ENABLE_LLM?: string;
  LLM_STREAM?: string;
  LLM_MODEL?: string;
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
    const body = await c.req.json<any>();
    const summary = buildSessionSummary(body, c.env as any);
    const shareTranscriptions = summary.shareTranscriptions === true;

    // Emit dataset texts directly to Sentry logs when present in the merged payload
    const dataset = summary.dataset;
    if (shareTranscriptions && dataset && (dataset.sttText || dataset.llmText)) {
      safely(() =>
        Sentry.logger.info('dataset.llm_io', {
          traceId: summary.id,
          'session.trace_id': summary.id,
          sttText: dataset.sttText ?? null,
          llmText: dataset.llmText ?? null,
          sttLen: dataset.sttText ? dataset.sttText.length : 0,
          llmLen: dataset.llmText ? dataset.llmText.length : 0,
          source: 'metrics.session',
        }),
      );
    }

    // Log one-line JSON summary
    safely(() => console.log(JSON.stringify(summary)));

    // Also record to Sentry for correlation
    await Sentry.startSpan({
      op: 'transcription.session_summary',
      name: `Session Summary ${summary.id}`,
      attributes: { 'session.trace_id': summary.id },
    }, async (span) => {
      // Flatten some key attributes for searchability
      span.setAttribute('pipeline', summary.pipeline);
      for (const [k, v] of Object.entries(summary.durations)) span.setAttribute(`dur.${k}`, v as any);
      for (const [k, v] of Object.entries(summary.traffic)) span.setAttribute(`traffic.${k}`, v as any);
      span.setAttribute('result.text_len', summary.result.textLen ?? 0);
      span.setAttribute('dataset.allowed', shareTranscriptions ? 1 : 0);
      if (summary.llm) {
        span.setAttribute('llm.provider', summary.llm.provider ?? '');
        if (summary.llm.model) span.setAttribute('llm.model', summary.llm.model);
        if (summary.llm.routeRules?.length) span.setAttribute('llm.route_rules', summary.llm.routeRules.join(','));
      }
      // Attach dataset text lengths (do not attach full text to span by default)
      try {
        const stt = (summary as any)?.dataset?.sttText as string | undefined;
        const llm = (summary as any)?.dataset?.llmText as string | undefined;
        if (typeof stt === 'string') span.setAttribute('dataset.stt_len', stt.length);
        if (typeof llm === 'string') span.setAttribute('dataset.llm_len', llm.length);
      } catch {}
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
  safely(() => Sentry.logger.info('User triggered test log', { action: 'test_log', route: '/logs/test' }));
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
