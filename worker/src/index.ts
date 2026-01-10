import { Hono } from "hono";
import { wsRoute } from "./handlers/ws";

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
// Track whether we've already prefetched to avoid doing it on every request.
let jwksPrefetched = false;

// Middleware to prefetch JWKS on first request (fire-and-forget)
app.use("*", async (c, next) => {
  // Only prefetch once per worker instance
  const supabaseUrl = c.env.SUPABASE_URL;
  if (!jwksPrefetched && supabaseUrl) {
    jwksPrefetched = true; // Set immediately to prevent race condition

    // Fire-and-forget prefetch - don't await, let it run in background
    (async () => {
      try {
        const { getJWKS } = await import("./auth/supabaseJwt");
        await getJWKS(supabaseUrl);
        console.log("[Auth] ✅ JWKS prefetch completed - cache is warm");
      } catch (err) {
        // Silent fail - JWKS will be fetched on first auth if this fails
        console.warn(
          "[Auth] ⚠️ JWKS prefetch failed (will fetch on first auth):",
          err,
        );
      }
    })();
  }

  await next();
});

// Health check
app.get("/", (c) => c.text("ok"));

// WebSocket transcription endpoint
app.get("/ws", wsRoute);

export default app;
