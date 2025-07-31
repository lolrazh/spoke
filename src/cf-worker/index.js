/**
 * Cloudflare Worker proxy for Groq audio transcriptions
 * - CORS handled for Electron renderer
 * - Copies inbound FormData to avoid bodyUsed issues
 * - Adds Connection: close on responses to mitigate TLS reuse/ERR_SSL_PROTOCOL_ERROR from Electron
 * - Validates minimal file size to avoid forwarding empty audio
 */
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Mode",
  };
  
  const withClose = (headers = {}) => ({
    ...headers,
    "Connection": "close",
  });
  
  export default {
    async fetch(req, env) {
      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: withClose(corsHeaders),
        });
      }
  
      if (req.method !== "POST") {
        return new Response(
          JSON.stringify({ error: "Method Not Allowed. Please use POST." }),
          {
            status: 405,
            headers: withClose({
              ...corsHeaders,
              "Content-Type": "application/json",
            }),
          },
        );
      }
  
      // Parse multipart form data
      let inboundFormData;
      try {
        inboundFormData = await req.formData();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid multipart form-data" }), {
          status: 400,
          headers: withClose({
            ...corsHeaders,
            "Content-Type": "application/json",
          }),
        });
      }
  
      // Validate presence and basic size of the 'file' part
      const file = inboundFormData.get("file");
      if (!(file instanceof Blob)) {
        return new Response(JSON.stringify({ error: "Missing 'file' field" }), {
          status: 400,
          headers: withClose({
            ...corsHeaders,
            "Content-Type": "application/json",
          }),
        });
      }
      // Groq minimum is ~0.01s; enforce a small floor in bytes (e.g., > 200 bytes)
      // WAV header alone is 44 bytes; require > 200 to avoid forwarding empty audio.
      if (file.size < 200) {
        return new Response(JSON.stringify({ error: "Audio too short" }), {
          status: 400,
          headers: withClose({
            ...corsHeaders,
            "Content-Type": "application/json",
          }),
        });
      }
  
      // Rebuild outbound form data
      const outboundFormData = new FormData();
      for (const [key, value] of inboundFormData.entries()) {
        outboundFormData.append(key, value);
      }
  
      // Forward to Groq
      let groqResponse;
      try {
        groqResponse = await fetch(
          "https://api.groq.com/openai/v1/audio/transcriptions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.GROQ_API_KEY}`,
              // Do not set Content-Type; let runtime set multipart boundary
            },
            body: outboundFormData,
          },
        );
      } catch (err) {
        // Network/TLS errors
        return new Response(
          JSON.stringify({
            error: "Upstream request failed",
            details: (err && (err.message || String(err))) || "unknown",
          }),
          {
            status: 502,
            headers: withClose({
              ...corsHeaders,
              "Content-Type": "application/json",
            }),
          },
        );
      }
  
      // Non-2xx from Groq
      if (!groqResponse.ok) {
        let errorPayload;
        try {
          errorPayload = await groqResponse.json();
        } catch {
          errorPayload = { text: await groqResponse.text() };
        }
        return new Response(
          JSON.stringify({ error: "Groq API Error", upstream: errorPayload }),
          {
            status: groqResponse.status,
            headers: withClose({
              ...corsHeaders,
              "Content-Type": "application/json",
            }),
          },
        );
      }
  
      // Success path: proxy JSON as-is
      let data;
      try {
        data = await groqResponse.json();
      } catch {
        // Fallback: text
        const text = await groqResponse.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { text };
        }
      }
  
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: withClose({
          ...corsHeaders,
          "Content-Type": "application/json",
        }),
      });
    },
  };
  