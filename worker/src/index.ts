import { Hono } from 'hono';
import { wsRoute } from './handlers/ws';

type Bindings = {
  GROQ_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BASETEN_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  ENABLE_LLM?: string;
  LLM_STREAM?: string;
  LLM_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SKIP_AUTH?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check
app.get('/', (c) => c.text('ok'));

// WebSocket transcription endpoint
app.get('/ws', wsRoute);

export default app;
