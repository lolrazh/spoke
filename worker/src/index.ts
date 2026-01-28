import { Hono } from "hono";
import { handlePrepare, handleTranscribe } from "./handlers/http";
import {
  corsMiddleware,
  errorHandler,
  requestIdMiddleware,
  authMiddleware,
} from "./middleware";

type Bindings = {
  GROQ_API_KEY?: string;
  SIMPLISMART_API_KEY?: string;
  BASETEN_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  ENABLE_LLM?: string;
  LLM_STREAM?: string;
  LLM_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SKIP_AUTH?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// 🍪 JWKS PREFETCH: Warm the cache on worker startup to eliminate first-auth cold start
// We can't access env.SUPABASE_URL at module level, so we prefetch on first request.
// Track prefetch state to avoid duplicate fetches and allow waiting.
let jwksPrefetchPromise: Promise<void> | null = null;

// Middleware to prefetch JWKS on first request
// For auth routes, we WAIT for prefetch to complete to avoid the 1.8s JWKS fetch delay
app.use("*", async (c, next) => {
  const supabaseUrl = c.env.SUPABASE_URL;
  const path = c.req.path;
  const isAuthRoute = path === "/prepare" || path === "/transcribe";

  // Start prefetch on first request (only once per worker instance)
  if (!jwksPrefetchPromise && supabaseUrl) {
    const prefetchStart = Date.now();
    jwksPrefetchPromise = (async () => {
      try {
        const { getJWKS } = await import("./auth/supabaseJwt");
        await getJWKS(supabaseUrl);
        console.log(
          `[Auth] ✅ JWKS prefetch completed in ${Date.now() - prefetchStart}ms`,
        );
      } catch (err) {
        console.warn("[Auth] ⚠️ JWKS prefetch failed:", err);
        // Don't throw - auth middleware will retry
      }
    })();
  }

  // For auth routes, WAIT for prefetch to ensure cache is warm
  // This prevents the race condition where auth middleware runs before prefetch completes
  if (isAuthRoute && jwksPrefetchPromise) {
    await jwksPrefetchPromise;
  }

  await next();
});

// Global middleware (applies to all routes including OPTIONS preflight)
app.use("*", corsMiddleware);
app.use("*", errorHandler);

// Health check
app.get("/", (c) => c.text("ok"));

// HTTP transcription endpoints
// Apply middleware: request ID -> auth -> handler
app.post("/prepare", requestIdMiddleware, authMiddleware, handlePrepare);

app.post("/transcribe", requestIdMiddleware, authMiddleware, handleTranscribe);

export default app;
