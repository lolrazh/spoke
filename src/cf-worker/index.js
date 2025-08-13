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
  "Access-Control-Expose-Headers": "Server-Timing, CF-Worker-Colo, X-Request-Id, X-Upstream-Status, X-Request-Size",
};

export default {
  async fetch(req, env) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
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

    const requestId = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const colo = (req.cf && req.cf.colo) || "unknown";
    const contentLength = req.headers.get("content-length");

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
