import { Hono } from 'hono';
import { wsRoute } from './handlers/ws';

type Bindings = {
  GROQ_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health
app.get('/', (c) => c.text('ok'));

// WebSocket ingest: 500 ms PCM16@16k frames
app.get('/ws', wsRoute);

export default {
  fetch: (req: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(req, env, ctx),
};
