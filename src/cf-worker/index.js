/**
 * Sonic Flow - Clean WebSocket-only Worker
 * Streams audio to Groq via AI Gateway
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version",
};

// Clean configuration
const AI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/sonic-flow/groq/audio/transcriptions";
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB safety cap

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // WebSocket transcription endpoint
    const upgradeHeader = req.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket" && 
        pathname.startsWith("/transcribe")) {
      
      return this.handleWebSocketTranscription(req, env);
    }

    // Health check endpoint
    if (req.method === "GET" && pathname === "/health") {
      return new Response(JSON.stringify({ 
        status: "ok", 
        timestamp: Date.now(),
        service: "sonic-flow-websocket" 
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Everything else gets 404
    return new Response(JSON.stringify({ 
      error: "Not found",
      message: "WebSocket endpoint: /transcribe" 
    }), { 
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  },

  async handleWebSocketTranscription(req, env) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const sessionId = crypto.randomUUID();

    console.log(`[${sessionId}] New WebSocket connection`);

    // Session state
    let sessionMeta = null;
    const audioChunks = [];
    let receivedBytes = 0;
    let closed = false;

    // Helper functions
    const sendJson = (obj) => {
      try { 
        server.send(JSON.stringify(obj)); 
      } catch (e) {
        console.warn(`[${sessionId}] Failed to send message:`, e);
      }
    };

    const closeSocket = (code = 1000, reason = "") => {
      if (closed) return;
      closed = true;
      console.log(`[${sessionId}] Closing: ${code} ${reason}`);
      try { server.close(code, reason); } catch {}
    };

    // Accept connection and send ack
    server.accept();
    sendJson({ 
      type: "ack", 
      sessionId,
      timestamp: Date.now() 
    });

    // Handle messages
    server.addEventListener("message", (event) => {
      if (closed) return;
      
      const data = event.data;

      // Handle control messages (JSON)
      if (typeof data === "string") {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          sendJson({ type: "error", message: "Invalid JSON" });
          return closeSocket(1003, "invalid json");
        }

        if (!msg?.type) {
          sendJson({ type: "error", message: "Missing message type" });
          return closeSocket(1003, "bad message");
        }

        switch (msg.type) {
          case "start":
            sessionMeta = {
              model: msg.model || "whisper-large-v3-turbo",
              language: msg.language || "en",
              mime: msg.mime || "audio/webm;codecs=opus"
            };
            console.log(`[${sessionId}] Session started:`, sessionMeta);
            sendJson({ type: "ready" });
            break;

          case "ping":
            sendJson({ type: "pong" });
            break;

          case "end":
            this.finalizeTranscription(sessionId, sessionMeta, audioChunks, env)
              .then((result) => {
                if (result.success) {
                  sendJson({ type: "final", text: result.text });
                  closeSocket(1000, "completed");
                } else {
                  sendJson({ type: "error", message: result.error });
                  closeSocket(1011, "transcription failed");
                }
              });
            break;

          default:
            sendJson({ type: "error", message: `Unknown type: ${msg.type}` });
            closeSocket(1003, "unknown control message");
        }
        return;
      }

      // Handle binary audio data
      if (data instanceof ArrayBuffer) {
        if (!sessionMeta) {
          sendJson({ type: "error", message: "Send 'start' before audio data" });
          return closeSocket(1002, "no start");
        }

        const chunk = new Uint8Array(data);
        receivedBytes += chunk.byteLength;
        
        if (receivedBytes > MAX_AUDIO_BYTES) {
          sendJson({ type: "error", message: "Audio exceeds 15MB limit" });
          return closeSocket(1009, "message too big");
        }

        audioChunks.push(chunk);
        console.log(`[${sessionId}] Received audio: ${chunk.byteLength} bytes (total: ${receivedBytes})`);
        
        // Debug first chunk to see if it looks like WebM
        if (audioChunks.length === 1) {
          const firstBytes = chunk.slice(0, 8);
          const hex = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.log(`[${sessionId}] First audio chunk header (hex): ${hex}`);
        }
        return;
      }

      // Unknown data type
      sendJson({ type: "error", message: "Unsupported data type" });
      closeSocket(1003, "unsupported frame");
    });

    server.addEventListener("close", () => {
      closed = true;
      console.log(`[${sessionId}] Connection closed`);
    });

    server.addEventListener("error", (e) => {
      console.error(`[${sessionId}] WebSocket error:`, e);
      closeSocket(1011, "server error");
    });

    return new Response(null, { status: 101, webSocket: client });
  },

  async finalizeTranscription(sessionId, sessionMeta, audioChunks, env) {
    try {
      if (!sessionMeta) {
        return { success: false, error: "Session not initialized" };
      }
      
      if (audioChunks.length === 0) {
        return { success: false, error: "No audio received" };
      }

      console.log(`[${sessionId}] Finalizing transcription: ${audioChunks.length} chunks`);

      // Combine audio chunks
      const totalBytes = audioChunks.reduce((sum, arr) => sum + arr.byteLength, 0);
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const arr of audioChunks) {
        merged.set(arr, offset);
        offset += arr.byteLength;
      }

      // Debug: Check if this looks like valid WebM data
      const firstBytes = merged.slice(0, 8);
      const firstBytesHex = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[${sessionId}] First 8 bytes (hex): ${firstBytesHex}`);
      
      // WebM files should start with specific bytes
      const isValidWebM = firstBytes[0] === 0x1A && firstBytes[1] === 0x45 && firstBytes[2] === 0xDF && firstBytes[3] === 0xA3;
      console.log(`[${sessionId}] Looks like valid WebM: ${isValidWebM}`);

      // Create form data for Groq
      const filename = sessionMeta.mime?.includes("webm") ? "audio.webm" : "audio.bin";
      const file = new File([merged], filename, { 
        type: sessionMeta.mime || "application/octet-stream" 
      });

      const form = new FormData();
      form.append("file", file);
      form.append("model", sessionMeta.model);
      form.append("language", sessionMeta.language);
      form.append("response_format", "json");
      form.append("temperature", "0");

      // Send to AI Gateway → Groq
      console.log(`[${sessionId}] Sending to AI Gateway: ${totalBytes} bytes, ${audioChunks.length} chunks, mime: ${sessionMeta.mime}`);
      console.log(`[${sessionId}] File info: name=${filename}, size=${file.size}, type=${file.type}`);
      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`[${sessionId}] AI Gateway error: ${response.status}`);
        console.error(`[${sessionId}] Error details: ${errorText}`);
        
        // Try to parse error as JSON for better debugging
        try {
          const errorObj = JSON.parse(errorText);
          console.error(`[${sessionId}] Parsed error:`, errorObj);
        } catch {}
        
        return { success: false, error: `Transcription failed: ${response.status}` };
      }

      const result = await response.json();
      const text = result?.text || "";
      
      console.log(`[${sessionId}] Transcription complete: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
      return { success: true, text };

    } catch (error) {
      console.error(`[${sessionId}] Finalization error:`, error);
      return { success: false, error: error.message || "Unknown error" };
    }
  }
};