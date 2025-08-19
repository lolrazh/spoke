import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Transcribe } from "./endpoints/transcribe";
import { Ping } from "./endpoints/ping";

// Minimal type for Workers AI binding
type Ai = {
  run: (model: string, input: unknown, options?: unknown) => Promise<any>;
};

// Cloudflare Bindings for this worker
interface Env {
  AI: Ai;
  AI_GATEWAY_ID?: string;
}

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Global CORS and common headers middleware
app.use("*", async (c, next) => {
  const started = Date.now();
  const reqId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  c.set("reqId", reqId);

  // Handle CORS preflight early
  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET, HEAD");
    c.header("Access-Control-Allow-Headers", "Content-Type, X-Mode");
    c.header(
      "Access-Control-Expose-Headers",
      "Server-Timing, CF-Worker-Colo, X-Request-Id",
    );
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  }

  await next();

  // Apply response headers
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", "Server-Timing, CF-Worker-Colo, X-Request-Id");
  c.header("Cache-Control", "no-store");
  c.header("X-Request-Id", reqId);
  c.header("CF-Worker-Colo", (c.req.raw as any)?.cf?.colo ?? "unknown");
  c.header("Server-Timing", `total;dur=${Date.now() - started}`);
});

// Central error handling
app.onError((err, c) => {
  return c.json({ error: err?.message ?? String(err) }, 500);
});

// Setup OpenAPI registry and mount endpoints
const openapi = fromHono(app, { docs_url: "/" });
openapi.get("/ping", Ping);
openapi.post("/transcribe", Transcribe);

// 404 handler
app.notFound((c) => c.json({ error: "Not Found" }, 404));

// Export the Hono app
export default app;
