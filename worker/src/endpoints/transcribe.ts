import type { Context, Hono } from "hono";
import { Buffer } from "node:buffer";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, X-Mode",
  "Access-Control-Expose-Headers": "Server-Timing, CF-Worker-Colo, X-Request-Id",
  "Cache-Control": "no-store",
};

export function registerTranscribe(app: Hono<{ Bindings: Env }>) {
  // Preflight
  app.options("/transcribe", () => new Response(null, { status: 204, headers: CORS }));

  // Transcribe endpoint
  app.post("/transcribe", async (c) => {
    const colo = (c.req.raw as any)?.cf?.colo ?? "unknown";
    const reqId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const t0 = Date.now();
    try {
      const form = await c.req.raw.formData();

      // Accept Blob in "file" or base64 string in "audio"
      let base64: string | null = null;
      const file = form.get("file");
      if (file && file instanceof Blob) {
        const buf = Buffer.from(await (file as Blob).arrayBuffer());
        base64 = buf.toString("base64");
      } else {
        const audio = form.get("audio");
        if (typeof audio === "string" && audio.trim()) base64 = audio.trim();
      }

      if (!base64) return withJson(c, { error: "No audio provided" }, 400);

      const language = str(form.get("language"));
      const initial_prompt = str(form.get("initial_prompt"));
      const task = str(form.get("task")) || "transcribe";
      const vad_filter = bool(form.get("vad_filter"));

      const aiOptions: any = {};
      if ((c.env as any).AI_GATEWAY_ID) aiOptions.gateway = { id: (c.env as any).AI_GATEWAY_ID };

      const result: any = await (c.env as any).AI.run(
        "@cf/openai/whisper-large-v3-turbo",
        { audio: base64, task, language, vad_filter, initial_prompt },
        aiOptions.gateway ? aiOptions : undefined,
      );

      const headers = new Headers(CORS);
      headers.set("CF-Worker-Colo", colo);
      headers.set("X-Request-Id", reqId);
      headers.set("Server-Timing", `ai_total;dur=${Date.now() - t0}`);

      return new Response(
        JSON.stringify({
          text: result?.text ?? "",
          vtt: result?.vtt ?? null,
          segments: result?.segments ?? null,
          info: result?.transcription_info ?? null,
        }),
        { status: 200, headers },
      );
    } catch (err: any) {
      return withJson(c, { error: err?.message || String(err) }, 500);
    }
  });
}

function withJson(c: Context, body: unknown, status = 200): Response {
  const headers = new Headers(CORS);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
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

