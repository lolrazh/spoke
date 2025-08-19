import { fromHono } from "chanfana";
import { Hono } from "hono";
// import { Buffer } from "node:buffer"; // not needed here
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Simple CORS headers used for Electron client
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, X-Mode",
  "Access-Control-Expose-Headers": "Server-Timing, CF-Worker-Colo, X-Request-Id",
  "Cache-Control": "no-store",
};

// Health check
app.get("/ping", (c) => {
  const headers = new Headers(CORS);
  headers.set("CF-Worker-Colo", (c.req.raw as any)?.cf?.colo ?? "unknown");
  headers.set("X-Request-Id", (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  return new Response(null, { status: 204, headers });
});

// Mount the /transcribe endpoint implemented in endpoints/transcribe
import { registerTranscribe } from "./endpoints/transcribe";
registerTranscribe(app);

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
