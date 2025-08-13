/**
 * Cloudflare Worker proxy for Groq audio transcriptions
 * - CORS handled for Electron renderer
 * - Pass-through streaming: forwards the request body directly to Groq
 * - Adds Server-Timing for simple latency visibility
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Mode",
  "Access-Control-Expose-Headers": "Server-Timing, CF-Worker-Colo, X-Request-Id, X-Upstream-Status, X-Request-Size, X-Warm-Triggered",
};

const lastWarmAtByColo = Object.create(null);
const WARM_TTL_MS = 20000;
const WARM_JITTER_MS = 3000;

function shouldTriggerWarm(colo) {
  const now = Date.now();
  const last = lastWarmAtByColo[colo] || 0;
  const jitter = (Math.random() * 2 - 1) * WARM_JITTER_MS;
  const effectiveTtl = WARM_TTL_MS + jitter;
  return now - last >= effectiveTtl;
}

function markWarm(colo) {
  lastWarmAtByColo[colo] = Date.now();
}

async function warmUpGroq(env) {
  const start = Date.now();
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      signal: AbortSignal.timeout(1500),
    });
    // Drain headers only; body not needed
    return Date.now() - start;
  } catch {
    return -1;
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const colo = (req.cf && req.cf.colo) || "unknown";
    const requestId = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const contentLength = req.headers.get("content-length");
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (req.method === "HEAD" && pathname === "/ping") {
      const t0 = Date.now();
      const headers = new Headers(corsHeaders);
      headers.set("Cache-Control", "no-store");
      headers.set("CF-Worker-Colo", colo);
      headers.set("X-Request-Id", requestId);
      if (contentLength) headers.set("X-Request-Size", contentLength);

      let warmTriggered = false;
      if (shouldTriggerWarm(colo)) {
        warmTriggered = true;
        markWarm(colo);
        if (ctx && ctx.waitUntil) ctx.waitUntil(warmUpGroq(env));
        else warmUpGroq(env); // best-effort if ctx not available
      }

      headers.set("X-Warm-Triggered", warmTriggered ? "1" : "0");
      headers.set("Server-Timing", `ping;dur=${Date.now() - t0}`);
      return new Response(null, { status: 204, headers });
    }

    if (req.method === "GET" && pathname === "/warm") {
      const headers = new Headers(corsHeaders);
      headers.set("Cache-Control", "no-store");
      headers.set("CF-Worker-Colo", colo);
      headers.set("X-Request-Id", requestId);
      if (contentLength) headers.set("X-Request-Size", contentLength);

      let serverTiming = "";
      let warmTriggered = false;
      if (shouldTriggerWarm(colo)) {
        markWarm(colo);
        warmTriggered = true;
        const ttfb = await warmUpGroq(env);
        if (ttfb >= 0) serverTiming = `warm_ttfb;dur=${ttfb}`;
      }
      headers.set("X-Warm-Triggered", warmTriggered ? "1" : "0");
      if (serverTiming) headers.set("Server-Timing", serverTiming);
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method Not Allowed. Please use POST." }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Pass-through: do not parse form-data; forward body stream directly
    const upstreamUrl = "https://api.groq.com/openai/v1/audio/transcriptions";

    const outgoingHeaders = new Headers();
    outgoingHeaders.set("Authorization", `Bearer ${env.GROQ_API_KEY}`);
    const contentType = req.headers.get("content-type");
    if (contentType) {
      outgoingHeaders.set("Content-Type", contentType);
    }

    const t0 = Date.now();
    let ttfbMs = 0;
    let groqResponse;
    try {
      const tFetchStart = Date.now();
      groqResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: outgoingHeaders,
        body: req.body,
      });
      ttfbMs = Date.now() - tFetchStart; // upstream TTFB
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Upstream request failed",
          details: (err && (err.message || String(err))) || "unknown",
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "CF-Worker-Colo": colo,
            "X-Request-Id": requestId,
            "X-Request-Size": contentLength || "unknown",
          },
        },
      );
    }

    const t1 = Date.now();
    const totalMs = t1 - t0;
    const serverTiming = [
      `groq_ttfb;dur=${ttfbMs}`,
      `worker_total;dur=${totalMs}`,
    ].join(", ");

    // Forward Groq response body as-is; keep status and content-type
    const respHeaders = new Headers(corsHeaders);
    const upstreamContentType = groqResponse.headers.get("content-type");
    if (upstreamContentType) {
      respHeaders.set("Content-Type", upstreamContentType);
    }
    respHeaders.set("Server-Timing", serverTiming);
    respHeaders.set("Cache-Control", "no-store");
    respHeaders.set("CF-Worker-Colo", colo);
    respHeaders.set("X-Request-Id", requestId);
    respHeaders.set("X-Upstream-Status", String(groqResponse.status));
    if (contentLength) respHeaders.set("X-Request-Size", contentLength);

    // For non-2xx, still stream the body back so the client can see upstream error payload
    return new Response(groqResponse.body, {
      status: groqResponse.status,
      headers: respHeaders,
    });
  },
};
