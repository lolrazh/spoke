import { Hono } from "hono";

type Bindings = {
  GROQ_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Simple in-memory connection tracking per IP
const connectionTracker = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 5;

function getClientIP(request: Request): string {
  return request.headers.get("cf-connecting-ip") || 
         request.headers.get("x-forwarded-for")?.split(",")[0] || 
         "unknown";
}

function trackConnection(ip: string): boolean {
  const current = connectionTracker.get(ip) || 0;
  if (current >= MAX_CONNECTIONS_PER_IP) {
    return false; // Reject
  }
  connectionTracker.set(ip, current + 1);
  return true;
}

function releaseConnection(ip: string): void {
  const current = connectionTracker.get(ip) || 0;
  if (current <= 1) {
    connectionTracker.delete(ip);
  } else {
    connectionTracker.set(ip, current - 1);
  }
}

// Health
app.get("/", (c) => c.text("ok"));

// WebSocket ingest: 100 ms PCM16@16k frames
app.get("/ws", (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.text("Expected a websocket connection", 426);
  }

  // Check connection limits
  const clientIP = getClientIP(c.req.raw);
  if (!trackConnection(clientIP)) {
    return c.text("Too many connections from your IP. Please try again later.", 429);
  }

  const { GROQ_API_KEY } = c.env;
  const [client, server] = Object.values(new WebSocketPair());

  let session = createEmptySession();
  session.wsAcceptAt = Date.now();
  // Track if socket has closed and allow aborting any in-flight STT
  let socketClosed = false;
  let sttAbort: AbortController | null = null;
  let sessionActive = false; // Prevent duplicate session starts

  server.accept();
  console.log("[WS] accepted");
  server.addEventListener("message", async (evt: MessageEvent) => {
    try {
      const data = evt.data;
      if (typeof data === "string") {
        const msg = safeJson(data);
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "start") {
          // Ignore duplicate start messages during active session
          if (sessionActive) {
            console.warn("[WS] Ignoring duplicate start message - session already active");
            return;
          }
          
          console.log("[WS] start");
          sessionActive = true;
          
          // Reset for a new session
          session = createEmptySession();
          session.startedAt = Date.now();
          session.version = msg.version ?? 1;
          session.format = msg.format ?? "pcm16le";
          session.rate = msg.rate ?? 16000;
          session.traceId = typeof msg.traceId === "string" ? msg.traceId : undefined;
          // (optional) language = msg.language
        } else if (msg.type === "end") {
          const t0 = Date.now();
          session.processingStartAt = t0;
          // Signal processing started
          if (!socketClosed) {
            try {
              server.send(
                JSON.stringify({
                  type: "status",
                  state: "processing",
                  traceId: session.traceId,
                  serverTs: Date.now(),
                }),
              );
            } catch (error) {
              console.error("[WS] Failed to send processing status:", error);
            }
          }

          // If canceled or empty, short-circuit
          if (session.canceled || session.totalBytes === 0) {
            const text = "";
            server.send(JSON.stringify({ type: "final", text }));
            safeClose(server, 1000, "done");
            session = createEmptySession();
            return;
          }

          // Assemble PCM → WAV
          const assembleStart = Date.now();
          const pcm = concat(session.chunks, session.totalBytes);
          const wav = wrapWav(pcm, session.rate, 1, 16);
          const assembleEnd = Date.now();
          const assembleMs = assembleEnd - assembleStart;

          // Call GROQ STT if key available
          let finalText = "";
          let groqStart = 0;
          let groqHeaders = 0;
          let groqBodyDone = 0;
          try {
            if (GROQ_API_KEY) {
              // Allow canceling if the client disconnects while STT is running
              sttAbort?.abort();
              sttAbort = new AbortController();
              groqStart = Date.now();
              const controller = new AbortController();
              const onExternalAbort = () => controller.abort();
              const timeoutId = setTimeout(() => controller.abort(), 25000);
              if (sttAbort.signal.aborted) controller.abort();
              else sttAbort.signal.addEventListener("abort", onExternalAbort);

              const res = await fetch(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
                  body: (() => {
                    const form = new FormData();
                    const file = new File([wav], "audio.wav", { type: "audio/wav" });
                    form.append("file", file);
                    form.append("model", "whisper-large-v3-turbo");
                    form.append("language", "en");
                    form.append(
                      "prompt",
                      "Your vocabulary includes: Sonic Flow, Sandheep Rajkumar, Groq, Supabase, Gemini 2.0 Flash Lite",
                    );
                    return form;
                  })(),
                  signal: controller.signal,
                },
              );
              groqHeaders = Date.now();
              if (!res.ok) {
                const body = await res.text();
                throw new Error(`GROQ STT error: ${res.status} ${body}`);
              }
              const json = (await res.json()) as { text?: string };
              groqBodyDone = Date.now();
              finalText = json?.text ?? "";
              clearTimeout(timeoutId);
              sttAbort.signal.removeEventListener("abort", onExternalAbort);
            } else {
              finalText = "";
            }
          } catch (e: any) {
            try {
              // Best-effort cleanup for timeout composition
              // @ts-ignore
              if (typeof timeoutId !== "undefined") clearTimeout(timeoutId);
              // @ts-ignore
              if (onExternalAbort)
                sttAbort?.signal?.removeEventListener("abort", onExternalAbort);
            } catch {}
            if (!socketClosed) {
              try {
                server.send(
                  JSON.stringify({
                    type: "error",
                    body: e?.message || "Transcription error",
                  }),
                );
              } catch (sendError) {
                console.error("[WS] Failed to send error message:", sendError);
              }
              safeClose(server, 1011, "stt error");
            }
            console.error("[WS] Transcription error:", e);
            session = createEmptySession();
            sessionActive = false;
            return;
          }

          if (!socketClosed) {
            try {
              const workerMetrics = {
                traceId: session.traceId,
                wsAcceptAt: session.wsAcceptAt ?? null,
                startedAt: session.startedAt ?? null,
                processingStartAt: session.processingStartAt ?? null,
                frames: session.frames,
                bytes: session.totalBytes,
                seqGaps: session.seqGaps,
                firstArrivalMs: session.firstArrivalMs,
                lastArrivalMs: session.lastArrivalMs,
                firstToLastArrivalMs:
                  session.firstArrivalMs && session.lastArrivalMs
                    ? session.lastArrivalMs - session.firstArrivalMs
                    : null,
                assembleMs,
                groq: {
                  startAt: groqStart || null,
                  headersAt: groqHeaders || null,
                  bodyDoneAt: groqBodyDone || null,
                  ttfbMs: groqStart && groqHeaders ? groqHeaders - groqStart : null,
                  bodyMs:
                    groqHeaders && groqBodyDone ? groqBodyDone - groqHeaders : null,
                  totalMs: groqStart && groqBodyDone ? groqBodyDone - groqStart : null,
                },
                finalSentAt: Date.now(),
              };
              server.send(
                JSON.stringify({
                  type: "final",
                  text: finalText,
                  traceId: session.traceId,
                  metrics: { worker: workerMetrics },
                }),
              );
            } catch (error) {
              console.error("[WS] Failed to send final result:", error);
            }
            safeClose(server, 1000, "done");
          }

          const t1 = Date.now();
          logSession("final", session, {
            assembleMs: t1 - t0,
            textLen: finalText.length,
          });
          session = createEmptySession();
          sessionActive = false;
        } else if (msg.type === "cancel") {
          // Discard buffered audio, but keep the socket open for reuse
          session = createEmptySession();
          session.canceled = true;
          sessionActive = false;
          // Abort any transcription in flight
          try {
            sttAbort?.abort();
          } catch (error) {
            console.error("[WS] Failed to abort transcription:", error);
          }
        }
      } else if (data instanceof ArrayBuffer) {
        // Binary frame: [16-byte header][payload]
        const buf = new Uint8Array(data);
        if (buf.byteLength < 16) return; // ignore
        const { seq, nbytes } = parseFrameHeader(buf);
        if (16 + nbytes > buf.byteLength) return; // malformed
        const payload = buf.subarray(16, 16 + nbytes);

        // Initialize first/last arrival tracking
        const now = Date.now();
        if (session.firstArrivalMs === null) session.firstArrivalMs = now;
        session.lastArrivalMs = now;

        // Track seq and gaps
        if (session.lastSeq !== null && seq !== session.lastSeq + 1) {
          session.seqGaps += 1;
        }
        session.lastSeq = seq;

        // Enforce a max buffer size (~20 MB)
        const MAX_BYTES = 20 * 1024 * 1024;
        if (session.totalBytes + payload.byteLength > MAX_BYTES) {
          server.send(
            JSON.stringify({ type: "error", body: "audio too large" }),
          );
          safeClose(server, 1009, "payload too large");
          session = createEmptySession();
          return;
        }

        // Append
        session.chunks.push(payload);
        session.totalBytes += payload.byteLength;
        session.frames += 1;
      }
    } catch (e: any) {
      console.error("[Worker] WebSocket message error:", e);
      try {
        server.send(
          JSON.stringify({ type: "error", body: e?.message || "ws error" }),
        );
        safeClose(server, 1011, "message processing error");
      } catch {}
      session = createEmptySession();
    }
  });

  server.addEventListener("close", (evt) => {
    // Clean up session on WebSocket close
    logSession("ws_close", session, {
      code: (evt as any)?.code || "unknown",
      reason: (evt as any)?.reason || "unknown",
    });
    socketClosed = true;
    try {
      sttAbort?.abort();
    } catch {}
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    
    // Release connection tracking
    releaseConnection(clientIP);
    
    // Acknowledge/ensure closure (per CF docs to prevent hung request errors)
    safeClose(
      server,
      (evt as any)?.code || 1000,
      (evt as any)?.reason || "client closed",
    );
  });

  server.addEventListener("error", (evt) => {
    // Clean up session and close on socket errors
    console.error("[WS] Socket error:", evt);
    socketClosed = true;
    try {
      sttAbort?.abort();
    } catch {}
    sttAbort = null;
    session = createEmptySession();
    sessionActive = false;
    
    // Release connection tracking
    releaseConnection(clientIP);
    
    safeClose(server, 1011, "socket error");
  });

  return new Response(null, { status: 101, webSocket: client });
});

export default {
  fetch: (req: Request, env: Bindings, ctx: ExecutionContext) =>
    app.fetch(req, env, ctx),
};

// ---- Helpers ----

function safeClose(ws: WebSocket, code = 1000, reason = "OK") {
  try {
    ws.close(code, reason);
  } catch (e) {
    // Ignore errors when closing (socket may already be closed)
  }
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parseFrameHeader(buf: Uint8Array) {
  // u32 seq | u32 nbytes | u64 ts
  const view = new DataView(buf.buffer, buf.byteOffset, 16);
  const seq = view.getUint32(0, true);
  const nbytes = view.getUint32(4, true);
  // const tsLo = view.getUint32(8, true); const tsHi = view.getUint32(12, true);
  return { seq, nbytes };
}

function concat(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function wrapWav(
  pcm: Uint8Array,
  rate = 16000,
  channels = 1,
  bitsPerSample = 16,
): Uint8Array {
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  // RIFF
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  // fmt
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  const byteRate = (rate * channels * bitsPerSample) >> 3;
  const blockAlign = (channels * bitsPerSample) >> 3;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function createEmptySession() {
  return {
    version: 2,
    format: "pcm16le" as "pcm16le",
    rate: 16000,
    startedAt: Date.now(),
    frames: 0,
    chunks: [] as Uint8Array[],
    totalBytes: 0,
    lastSeq: null as number | null,
    seqGaps: 0,
    firstArrivalMs: null as number | null,
    lastArrivalMs: null as number | null,
    canceled: false,
    traceId: undefined as string | undefined,
    wsAcceptAt: undefined as number | undefined,
    processingStartAt: undefined as number | undefined,
  };
}

function logSession(
  tag: string,
  s: ReturnType<typeof createEmptySession>,
  extra?: Record<string, unknown>,
) {
  try {
    const info = {
      tag,
      traceId: (s as any).traceId ?? null,
      frames: s.frames,
      bytesKB: Number((s.totalBytes / 1024).toFixed(2)),
      seqGaps: s.seqGaps,
      firstToLastArrivalMs:
        s.firstArrivalMs && s.lastArrivalMs
          ? s.lastArrivalMs - s.firstArrivalMs
          : null,
      ...extra,
    };
    console.log("[WS]", info);
  } catch (error) {
    console.error("[WS] Failed to log session:", error);
  }
}

async function groqTranscribe(
  wav: Uint8Array,
  apiKey: string,
  externalSignal?: AbortSignal,
): Promise<{ text: string } | null> {
  const form = new FormData();
  const file = new File([wav], "audio.wav", { type: "audio/wav" });
  form.append("file", file);
  form.append("model", "whisper-large-v3-turbo");
  // Hardcoded parameters for production
  form.append("language", "en");
  form.append(
    "prompt",
    "Your vocabulary includes: Sonic Flow, Sandheep Rajkumar, Groq, Supabase, Gemini 2.0 Flash Lite",
  );

  // Add timeout to prevent hanging
  // Compose a controller that aborts on either timeout or external signal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 second timeout
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);
    if (externalSignal)
      externalSignal.removeEventListener("abort", onExternalAbort);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GROQ STT error: ${res.status} ${body}`);
    }
    const json = await res.json();
    // OpenAI-compatible response shape: { text: string, ... }
    return json as { text: string };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (externalSignal)
      externalSignal.removeEventListener("abort", onExternalAbort);
    if (err.name === "AbortError") {
      throw new Error("Transcription aborted or timed out");
    }
    throw err;
  }
}
