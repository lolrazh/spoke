import { fromHono } from "chanfana";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/cloudflare-workers";
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
  GROQ_API_KEY?: string;
  GROQ_STT_MODEL?: string;
}

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Global CORS and common headers middleware
app.use("*", async (c, next) => {
  const isWS = c.req.header("upgrade")?.toLowerCase() === "websocket";
  const started = Date.now();
  const reqId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  c.set("reqId", reqId);
  c.set("startTime", started);
  c.set("serverTimings", [] as string[]);

  if (isWS) {
    // Do not modify headers on upgraded response
    return next();
  }

  // Handle CORS preflight early
  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET, HEAD");
    c.header("Access-Control-Allow-Headers", "Content-Type, X-Mode");
    c.header("Access-Control-Expose-Headers", "Server-Timing, CF-Worker-Colo, X-Request-Id");
    c.header("Timing-Allow-Origin", "*");
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  }

  await next();

  // Apply response headers
  const colo = (c.req.raw as any)?.cf?.colo ?? "unknown";
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", "Server-Timing, CF-Worker-Colo, X-Request-Id");
  c.header("Timing-Allow-Origin", "*");
  c.header("Cache-Control", "no-store");
  c.header("X-Request-Id", reqId);
  c.header("CF-Worker-Colo", colo);
  const timings = (c.get("serverTimings") as string[]) || [];
  timings.unshift(`total;dur=${Date.now() - started}`);
  c.header("Server-Timing", timings.join(", "));

  // Minimal structured log
  try {
    const log = (c.get("log") as Record<string, unknown>) || {};
    const status = c.res?.status ?? 200;
    const path = new URL(c.req.url).pathname;
    const base: Record<string, unknown> = {
      t: new Date().toISOString(),
      reqId,
      colo,
      method: c.req.method,
      path,
      status,
      totalMs: Date.now() - started,
    };
    // Merge limited route-specific metrics
    const merged = { ...base, ...log };
    console.log(JSON.stringify(merged));
  } catch {}
});

// Central error handling
app.onError((err, c) => {
  return c.json({ error: err?.message ?? String(err) }, 500);
});

// Setup OpenAPI registry and mount endpoints
const openapi = fromHono(app, { docs_url: "/" });
openapi.get("/ping", Ping);
openapi.post("/transcribe", Transcribe);

// --- The WebSocket endpoint (no HTTP fallback) ---
app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const buffers: Uint8Array[] = [];
    const meta: { language?: string } = {};
    
    const isWav = (bytes: Uint8Array) => {
      if (bytes.length < 12) return false;
      return (
        bytes[0] === 0x52 && // R
        bytes[1] === 0x49 && // I
        bytes[2] === 0x46 && // F
        bytes[3] === 0x46 && // F
        bytes[8] === 0x57 && // W
        bytes[9] === 0x41 && // A
        bytes[10] === 0x56 && // V
        bytes[11] === 0x45 // E
      );
    };

    const wavifyPcm16le = (pcm: Uint8Array, sampleRate = 16000, channels = 1, bitsPerSample = 16) => {
      // pcm is raw Int16LE mono at 16k; construct RIFF/WAVE header
      const bytesPerSample = bitsPerSample / 8; // 2
      const dataChunkSize = pcm.length; // already bytes
      const blockAlign = channels * bytesPerSample; // 2
      const byteRate = sampleRate * blockAlign; // 32000
      const riffChunkSize = 36 + dataChunkSize;

      const header = new ArrayBuffer(44);
      const view = new DataView(header);

      // ChunkID "RIFF"
      view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
      // ChunkSize
      view.setUint32(4, riffChunkSize, true);
      // Format "WAVE"
      view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
      // Subchunk1ID "fmt "
      view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
      // Subchunk1Size (16 for PCM)
      view.setUint32(16, 16, true);
      // AudioFormat (1 = PCM)
      view.setUint16(20, 1, true);
      // NumChannels
      view.setUint16(22, channels, true);
      // SampleRate
      view.setUint32(24, sampleRate, true);
      // ByteRate
      view.setUint32(28, byteRate, true);
      // BlockAlign
      view.setUint16(32, blockAlign, true);
      // BitsPerSample
      view.setUint16(34, bitsPerSample, true);
      // Subchunk2ID "data"
      view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
      // Subchunk2Size
      view.setUint32(40, dataChunkSize, true);

      const out = new Uint8Array(44 + dataChunkSize);
      out.set(new Uint8Array(header), 0);
      out.set(pcm, 44);
      return out;
    };

    const toBase64 = (bytes: Uint8Array) => {
      // efficient base64 without blowing the stack
      let s = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
      }
      return btoa(s);
    };
    
    const concat = (chunks: Uint8Array[]) => {
      const len = chunks.reduce((n, b) => n + b.length, 0);
      const out = new Uint8Array(len);
      let o = 0;
      for (const b of chunks) { out.set(b, o); o += b.length; }
      return out;
    };

    return {
      onMessage: async (evt, ws) => {
        // Strings are control/metadata; binary is audio
        if (typeof evt.data === "string") {
          try {
            const msg = JSON.parse(evt.data);
            if (msg?.type === "start" && msg.language) meta.language = String(msg.language);
            if (msg?.type === "end") {
              ws.send(JSON.stringify({ type: "status", state: "processing" }));

              let bytes = concat(buffers);
              // If the stream is raw PCM Int16LE, wrap it as WAV for Groq
              if (!isWav(bytes)) {
                bytes = wavifyPcm16le(bytes, 16000, 1, 16);
              }

              // If a Groq key exists, prefer Groq; else use Workers AI
              if (c.env.GROQ_API_KEY) {
                const file = new File([new Blob([bytes], { type: "audio/wav" })], "audio.wav", { type: "audio/wav" });
                const fd = new FormData();
                fd.set("file", file);
                fd.set("model", c.env.GROQ_STT_MODEL || "whisper-large-v3");
                if (meta.language) fd.set("language", meta.language);
                fd.set("response_format", "verbose_json");
                fd.set("prompt", "Vocabulary: Sandheep Rajkumar, Sonic Flow, Groq, Supabase, Gemini Flash Lite");

                const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${c.env.GROQ_API_KEY}` },
                  body: fd,
                });
                if (!resp.ok) {
                  ws.send(JSON.stringify({ type: "error", status: resp.status, body: await resp.text() }));
                  return ws.close(1011, "groq_error");
                }
                const groq = await resp.json();
                ws.send(JSON.stringify({ type: "final", text: groq?.text ?? "", segments: groq?.segments ?? null }));
                return ws.close(1000, "done");
              } else {
                const b64 = toBase64(bytes); // Workers AI wants base64
                const res = await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
                  audio: b64,
                  task: "transcribe",
                  language: meta.language || "en",
                  vad_filter: true,
                  initial_prompt: "Vocabulary: Sandheep Rajkumar, Sonic Flow, Groq, Supabase, Gemini Flash Lite",
                }, c.env.AI_GATEWAY_ID ? { gateway: { id: c.env.AI_GATEWAY_ID } } : undefined);

                ws.send(JSON.stringify({ type: "final", text: res?.text ?? "", segments: res?.segments ?? null }));
                return ws.close(1000, "done");
              }
            }
          } catch {
            // Ignore non-JSON text messages
          }
        } else {
          // Binary frame (ArrayBuffer)
          const ab: ArrayBuffer = (evt.data as ArrayBuffer);
          buffers.push(new Uint8Array(ab));
          // Optional progress acks
          // ws.send(JSON.stringify({ type: "ack", bytes: buffers.at(-1)?.length ?? 0 }));
        }
      },
      onError: (_e, ws) => { try { ws.close(1011, "internal_error"); } catch {} },
      // onClose not needed for v1
    };
  })
);

// 404 handler
app.notFound((c) => c.json({ error: "Not Found" }, 404));

// Export the Hono app
export default app;
