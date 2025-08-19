import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Buffer } from "node:buffer";
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

// CORS preflight for /transcribe
app.options("/transcribe", (c) => new Response(null, { status: 204, headers: CORS }));

// Minimal POST /transcribe: accepts multipart 'file' or base64 'audio'
app.post("/transcribe", async (c) => {
  const colo = (c.req.raw as any)?.cf?.colo ?? "unknown";
  const reqId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const t0 = Date.now();
  try {
    const form = await c.req.raw.formData();

    // Read audio as base64 (either file upload or direct base64 string)
    let base64: string | null = null;
    const file = form.get("file");
    if (file && file instanceof Blob) {
      const buf = Buffer.from(await (file as Blob).arrayBuffer());
      base64 = buf.toString("base64");
    } else {
      const audio = form.get("audio");
      if (typeof audio === "string" && audio.trim()) base64 = audio.trim();
    }

    if (!base64) {
      c.header("Content-Type", "application/json");
      setCors(c);
      return c.json({ error: "No audio provided" }, 400);
    }

    // Optional params forwarded to Workers AI whisper model
    const language = str(form.get("language"));
    const initial_prompt = str(form.get("initial_prompt"));
    const task = str(form.get("task")) || "transcribe"; // or "translate"
    const vad_filter = bool(form.get("vad_filter"));

    const aiOptions: any = {};
    if ((c.env as any).AI_GATEWAY_ID) aiOptions.gateway = { id: (c.env as any).AI_GATEWAY_ID };

    const result: any = await (c.env as any).AI.run(
      "@cf/openai/whisper-large-v3-turbo",
      {
        audio: base64,
        task,
        language,
        vad_filter,
        initial_prompt,
      },
      aiOptions.gateway ? aiOptions : undefined,
    );

    c.header("Server-Timing", `ai_total;dur=${Date.now() - t0}`);
    c.header("CF-Worker-Colo", colo);
    c.header("X-Request-Id", reqId);
    setCors(c);
    return c.json({
      text: result?.text ?? "",
      vtt: result?.vtt ?? null,
      segments: result?.segments ?? null,
      info: result?.transcription_info ?? null,
    });
  } catch (err: any) {
    setCors(c);
    c.header("Content-Type", "application/json");
    return c.json({ error: err?.message || String(err) }, 500);
  }
});

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

function setCors(c: import("hono").Context) {
  for (const [k, v] of Object.entries(CORS)) c.header(k, v);
}

function str(x: FormDataEntryValue | null): string | undefined {
  return typeof x === "string" && x.trim() ? x.trim() : undefined;
}

function bool(x: FormDataEntryValue | null): boolean | undefined {
  if (typeof x !== "string") return undefined;
  const v = x.toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}
