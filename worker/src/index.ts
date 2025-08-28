import { Hono } from 'hono';
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

export default Sentry.withSentry(
  (env: Bindings) => {
    const { id: versionId } = env.CF_VERSION_METADATA || { id: 'unknown' };

    return {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT || 'production',
      release: versionId,
      sendDefaultPii: true,
      tracesSampleRate: env.SENTRY_ENVIRONMENT === 'production' ? 0.1 : 1.0,
    };
  },
  app
);
